ALTER TABLE whatsapp_connections
  ADD COLUMN worker_id text,
  ADD COLUMN lease_until timestamptz;
CREATE INDEX whatsapp_connections_lease ON whatsapp_connections(lease_until)
  WHERE status IN ('connecting','qr_ready','syncing','connected','reconnecting');
