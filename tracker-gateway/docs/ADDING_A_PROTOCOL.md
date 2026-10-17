# Adding a GPS protocol or HTTP API adapter

1. Create `internal/<name>/` with `Adapter` implementing `protocol.Adapter`.
2. Decode **all** vendor IO/tags into `fix.RawAttrs` (do not hardcode app meanings).
3. Register in `main.go` and add env port to `config.Load`.
4. Seed `tracker_protocol_params` + a `tracker_device_profiles` row (completeness=`experimental` or `mvp`).
5. Add Admin protocol option with status label.
6. Ship golden fixtures under `*_test.go`.
7. Promote status to `partial` / `certified` only after checklist + Device Manager profile is proven.

HTTP/REST vendor clouds: implement as an HTTP handler on the JSON adapter port or a sibling adapter that posts into the same `store.Ingest` path.
