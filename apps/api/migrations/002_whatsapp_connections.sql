CREATE TABLE whatsapp_connections (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES companies(id),
  label text NOT NULL DEFAULT 'WhatsApp principal',
  status text NOT NULL DEFAULT 'disconnected' CHECK(status IN ('connecting','qr_ready','syncing','connected','reconnecting','disconnected','attention','error')),
  jid text,
  phone text,
  profile_name text,
  connected_at timestamptz,
  last_seen_at timestamptz,
  last_error_code text,
  last_error_message text,
  reconnect_attempts integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES identities(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id)
);
CREATE INDEX whatsapp_connections_status ON whatsapp_connections(tenant_id,status);

-- The application encrypts every payload with AES-256-GCM before it reaches PostgreSQL.
-- A row per Signal key avoids rewriting the complete session on every protocol update.
CREATE TABLE whatsapp_auth_keys (
  tenant_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  category text NOT NULL,
  key_id text NOT NULL,
  encrypted_payload text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,connection_id,category,key_id),
  FOREIGN KEY(tenant_id,connection_id) REFERENCES whatsapp_connections(tenant_id,id) ON DELETE CASCADE
);

ALTER TABLE whatsapp_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_connections FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON whatsapp_connections
  USING (tenant_id = nullif(current_setting('caju.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('caju.tenant_id',true),'')::uuid);
ALTER TABLE whatsapp_auth_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_auth_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON whatsapp_auth_keys
  USING (tenant_id = nullif(current_setting('caju.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('caju.tenant_id',true),'')::uuid);

-- The gateway can discover sessions after a restart, but receives only identifiers.
-- All subsequent reads still run inside the tenant-scoped transaction and RLS.
CREATE FUNCTION whatsapp_resume_targets() RETURNS TABLE(tenant_id uuid,connection_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT c.tenant_id,c.id FROM whatsapp_connections c
  WHERE c.status IN ('connecting','qr_ready','syncing','connected','reconnecting');
$$;
REVOKE ALL ON FUNCTION whatsapp_resume_targets() FROM PUBLIC;
