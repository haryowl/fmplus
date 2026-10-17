package dispatch

import (
	"context"
	"log"
	"time"

	"github.com/haryowl/fmplus/tracker-gateway/internal/concox"
	"github.com/haryowl/fmplus/tracker-gateway/internal/jt808"
	"github.com/haryowl/fmplus/tracker-gateway/internal/protocol"
	"github.com/haryowl/fmplus/tracker-gateway/internal/ruptela"
	"github.com/haryowl/fmplus/tracker-gateway/internal/store"
	"github.com/haryowl/fmplus/tracker-gateway/internal/teltonika"
)

// FlushPending sends queued tracker_commands to online sessions.
func FlushPending(ctx context.Context, st *store.Store, sessions *protocol.Registry) {
	cmds, err := st.ListPendingCommands(ctx, 50)
	if err != nil || len(cmds) == 0 {
		return
	}
	tel := teltonika.Adapter{}
	cx := concox.Adapter{}
	rup := ruptela.Adapter{}
	jt := jt808.Adapter{}
	for _, cmd := range cmds {
		sess, ok := sessions.SessionByDevice(cmd.DeviceID)
		if !ok || sess.Conn == nil {
			continue
		}
		var payload []byte
		encErr := error(nil)
		switch {
		case cmd.Protocol == "teltonika" || cmd.CommandType == "teltonika_codec12":
			payload, encErr = tel.EncodeDownlink(cmd)
		case cmd.Protocol == "concox" || cmd.CommandType == "concox_gprs":
			payload, encErr = cx.EncodeDownlink(cmd)
		case cmd.Protocol == "ruptela" || cmd.CommandType == "ruptela_sms":
			payload, encErr = rup.EncodeDownlink(cmd)
		case cmd.Protocol == "jt808" || cmd.Protocol == "subiao" ||
			cmd.CommandType == "jt808" || cmd.CommandType == "jt808_8103" || cmd.CommandType == "jt808_8500":
			phone := ""
			if sess.Meta != nil {
				phone = sess.Meta["phone"]
			}
			if phone == "" {
				continue // wait for uplink flush with known phone
			}
			payload, encErr = jt.EncodeDownlink(cmd, phone)
		case cmd.Protocol == "galileosky":
			// MVP: raw/text only until a certified Galileosky downlink frame exists.
			payload = cmd.PayloadBytes()
			if len(payload) == 0 && cmd.PayloadText != "" {
				payload = []byte(cmd.PayloadText)
			}
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
			log.Printf("[dispatch] write %s: %v", cmd.ID, werr)
			continue
		}
		_ = st.MarkCommandSent(ctx, cmd.ID)
		log.Printf("[dispatch] sent command %s to device %s", cmd.ID, cmd.DeviceID)
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
