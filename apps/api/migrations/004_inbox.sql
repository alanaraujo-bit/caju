CREATE TABLE conversations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES companies(id),
  whatsapp_connection_id uuid NOT NULL,
  remote_jid text NOT NULL,
  contact_id uuid,
  status text NOT NULL DEFAULT 'waiting' CHECK(status IN ('waiting','open','closed','followup')),
  assignee_id uuid,
  department_id uuid,
  unread_count integer NOT NULL DEFAULT 0 CHECK(unread_count >= 0),
  protocol text NOT NULL,
  last_message_at timestamptz,
  last_message_preview text NOT NULL DEFAULT '',
  last_message_from_me boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,whatsapp_connection_id,remote_jid),
  FOREIGN KEY(tenant_id,whatsapp_connection_id) REFERENCES whatsapp_connections(tenant_id,id),
  FOREIGN KEY(tenant_id,contact_id) REFERENCES contacts(tenant_id,id),
  FOREIGN KEY(tenant_id,assignee_id) REFERENCES memberships(tenant_id,id),
  FOREIGN KEY(tenant_id,department_id) REFERENCES departments(tenant_id,id)
);
CREATE INDEX conversations_recent ON conversations(tenant_id,last_message_at DESC NULLS LAST,updated_at DESC);
CREATE INDEX conversations_status ON conversations(tenant_id,status,updated_at DESC);

CREATE TABLE messages (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES companies(id),
  conversation_id uuid NOT NULL,
  whatsapp_connection_id uuid NOT NULL,
  external_id text NOT NULL,
  direction text NOT NULL CHECK(direction IN ('inbound','outbound','internal')),
  kind text NOT NULL CHECK(kind IN ('text','image','video','audio','document','sticker','unknown')),
  body text NOT NULL DEFAULT '',
  media_name text,
  sender_name text,
  sent_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'received' CHECK(status IN ('received','sent','delivered','read','failed')),
  reply_to_external_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,whatsapp_connection_id,external_id),
  UNIQUE(tenant_id,id),
  FOREIGN KEY(tenant_id,conversation_id) REFERENCES conversations(tenant_id,id) ON DELETE CASCADE,
  FOREIGN KEY(tenant_id,whatsapp_connection_id) REFERENCES whatsapp_connections(tenant_id,id)
);
CREATE INDEX messages_conversation ON messages(tenant_id,conversation_id,sent_at DESC,id DESC);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['conversations','messages'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY tenant_boundary ON %I USING (tenant_id = nullif(current_setting(''caju.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''caju.tenant_id'',true),'''')::uuid)',t);
  END LOOP;
END $$;
