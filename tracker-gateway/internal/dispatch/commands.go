package dispatch

import (
	"context"
	"log"
	"strconv"
	"time"

	"github.com/haryowl/fmplus/tracker-gateway/internal/concox"
	"github.com/haryowl/fmplus/tracker-gateway/internal/galileosky"
	"github.com/haryowl/fmplus/tracker-gateway/internal/jt808"
	"github.com/haryowl/fmplus/tracker-gateway/internal/protocol"
	"github.com/haryowl/fmplus/tracker-gateway/internal/ruptela"
	"github.com/haryowl/fmplus/tracker-gateway/internal/store"
	"github.com/haryowl/fmplus/tracker-gateway/internal/teltonika"
)

func isJT808Command(protocol, commandType string) bool {
	switch protocol {
	case "jt808", "subiao":
		return true
	}
	switch commandType {
	case "jt808", "jt808_8103", "jt808_8104", "jt808_8105", "jt808_8107",
		"jt808_8201", "jt808_8500", "terminal_control", "param", "control",
		"vehicle_control", "query_params", "query_attrs", "query_location":
		return true
	}
	return false
}

func downlinkCorr(protocol, commandType string, payload []byte, sess *protocol.ConnSession) string {
	switch {
	case isJT808Command(protocol, commandType):
		return jt808.DownlinkCorrID(payload)
	case protocol == "concox" || commandType == "concox_gprs":
		return concox.DownlinkCorrID(payload)
	case protocol == "ruptela" || commandType == "ruptela_sms":
		return "108"
	case protocol == "galileosky" || commandType == "galileosky_text":
		// Replies are text/tag based — no wire serial; ack uses latest-sent.
		return ""
	case protocol == "teltonika" || commandType == "teltonika_codec12":
		// Codec12 responses do not echo a stable command id — latest-sent only.
		return ""
	default:
		if sess != nil && sess.Meta != nil && sess.Meta["seq"] != "" {
			return sess.Meta["seq"]
		}
		return ""
	}
}

// FlushPending claims and sends queued tracker_commands to online sessions.
func FlushPending(ctx context.Context, st *store.Store, sessions *protocol.Registry) {
	tel := teltonika.Adapter{}
	cx := concox.Adapter{}
	rup := ruptela.Adapter{}
	jt := jt808.Adapter{}
	gs := galileosky.Adapter{}
	for i := 0; i < 50; i++ {
		cmdPtr, err := st.ClaimNextPendingCommand(ctx)
		if err != nil || cmdPtr == nil {
			return
		}
		cmd := *cmdPtr
		sess, ok := sessions.SessionByDevice(cmd.DeviceID)
		if !ok || sess.Conn == nil {
			// Not online — put back so session flush can take it on connect.
			_ = st.RequeueCommand(ctx, cmd.ID)
			return
		}
		var payload []byte
		encErr := error(nil)
		switch {
		case cmd.Protocol == "teltonika" || cmd.CommandType == "teltonika_codec12":
			payload, encErr = tel.EncodeDownlink(cmd)
		case cmd.Protocol == "concox" || cmd.CommandType == "concox_gprs":
			var ser uint16 = 1
			if sess.Meta != nil {
				if n, err := strconv.ParseUint(sess.Meta["seq"], 10, 16); err == nil && n > 0 {
					ser = uint16(n) + 1
				}
			}
			payload, encErr = cx.EncodeDownlinkSerial(cmd, ser)
		case cmd.Protocol == "ruptela" || cmd.CommandType == "ruptela_sms":
			payload, encErr = rup.EncodeDownlink(cmd)
		case isJT808Command(cmd.Protocol, cmd.CommandType):
			phone := ""
			var seq uint16
			v2019 := false
			if sess.Meta != nil {
				phone = sess.Meta["phone"]
				if n, err := strconv.ParseUint(sess.Meta["seq"], 10, 16); err == nil {
					seq = uint16(n)
				}
				v2019 = sess.Meta["jt808_ver"] == "2019"
			}
			if phone == "" {
				_ = st.RequeueCommand(ctx, cmd.ID)
				return // wait for uplink flush with known phone
			}
			payload, encErr = jt.EncodeDownlinkSeq(cmd, phone, &seq, v2019)
		case cmd.Protocol == "galileosky" || cmd.CommandType == "galileosky_text":
			payload, encErr = gs.EncodeDownlink(cmd)
		default:
			payload = cmd.PayloadBytes()
			if len(payload) == 0 && cmd.PayloadText != "" {
				payload = []byte(cmd.PayloadText)
			}
		}
		if encErr != nil {
			log.Printf("[dispatch] encode %s: %v", cmd.ID, encErr)
			_ = st.MarkCommandFailed(ctx, cmd.ID, encErr.Error())
			continue
		}
		if len(payload) == 0 {
			_ = st.MarkCommandFailed(ctx, cmd.ID, "empty payload")
			continue
		}
		if _, werr := sess.Conn.Write(payload); werr != nil {
			log.Printf("[dispatch] write %s: %v — requeue", cmd.ID, werr)
			_ = st.RequeueCommand(ctx, cmd.ID)
			sessions.Unbind(sess)
			continue
		}
		corr := downlinkCorr(cmd.Protocol, cmd.CommandType, payload, sess)
		_ = st.MarkCommandSentCorr(ctx, cmd.ID, corr)
		if corr != "" && sess.Meta != nil {
			sess.Meta["seq"] = corr
		}
		log.Printf("[dispatch] sent command %s to device %s corr=%s", cmd.ID, cmd.DeviceID, corr)
	}
}

// Loop polls pending commands until ctx done.
func Loop(ctx context.Context, st *store.Store, sessions *protocol.Registry, every time.Duration) {
	if every < time.Second {
		every = 2 * time.Second
	}
	t := time.NewTicker(every)
	defer t.Stop()
	expireEvery := 0
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			FlushPending(ctx, st, sessions)
			expireEvery++
			if expireEvery >= 30 { // ~60s at 2s tick
				expireEvery = 0
				if n, err := st.ExpireStaleCommands(ctx, 24*time.Hour, 30*time.Minute); err != nil {
					log.Printf("[dispatch] expire: %v", err)
				} else if n > 0 {
					log.Printf("[dispatch] expired %d stale commands", n)
				}
			}
		}
	}
}
