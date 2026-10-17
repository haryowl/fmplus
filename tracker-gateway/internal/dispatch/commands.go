package dispatch

import (
	"context"
	"log"
	"time"

	"github.com/haryowl/fmplus/tracker-gateway/internal/protocol"
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
	for _, cmd := range cmds {
		sess, ok := sessions.SessionByDevice(cmd.DeviceID)
		if !ok || sess.Conn == nil {
			continue
		}
		var payload []byte
		switch cmd.Protocol {
		case "teltonika":
			payload, err = tel.EncodeDownlink(cmd)
		default:
			// JT808/subiao flush on-read in jt808 handler; raw hex/text fallback here
			payload = cmd.PayloadBytes()
			if len(payload) == 0 && cmd.PayloadText != "" {
				payload = []byte(cmd.PayloadText)
			}
		}
		if err != nil || len(payload) == 0 {
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
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			FlushPending(ctx, st, sessions)
		}
	}
}
