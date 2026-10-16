-- Optional video / media channel metadata on tracker devices (AVL stays separate).
ALTER TABLE tracker_devices
  ADD COLUMN IF NOT EXISTS video_channel_id TEXT,
  ADD COLUMN IF NOT EXISTS video_rtsp_url TEXT,
  ADD COLUMN IF NOT EXISTS video_notes TEXT;
