CREATE TABLE message_media (
  tenant_id uuid NOT NULL,
  message_id uuid PRIMARY KEY,
  mime text NOT NULL,
  name text NOT NULL,
  content bytea NOT NULL CHECK(octet_length(content) BETWEEN 1 AND 10485760),
  FOREIGN KEY(tenant_id,message_id) REFERENCES messages(tenant_id,id) ON DELETE CASCADE
);
ALTER TABLE message_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_media FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_boundary ON message_media USING(tenant_id=nullif(current_setting('caju.tenant_id',true),'')::uuid) WITH CHECK(tenant_id=nullif(current_setting('caju.tenant_id',true),'')::uuid);
