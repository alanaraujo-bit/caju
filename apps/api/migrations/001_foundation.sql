CREATE TABLE plans (
  code text PRIMARY KEY, name text NOT NULL, limits jsonb NOT NULL, features jsonb NOT NULL
);
INSERT INTO plans VALUES ('setup','Configuração', '{"users":5,"departments":5,"numbers":1}', '["contacts","quick_replies","followups"]');
CREATE TABLE companies (
  id uuid PRIMARY KEY, name text NOT NULL, status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
  plan_code text NOT NULL REFERENCES plans(code), settings jsonb NOT NULL DEFAULT '{}',
  onboarding_completed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE identities (
  id uuid PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE, password_hash text NOT NULL,
  theme text NOT NULL DEFAULT 'claro', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE memberships (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES companies(id), user_id uuid NOT NULL REFERENCES identities(id),
  role text NOT NULL CHECK(role IN ('admin','supervisor','agent')), permissions jsonb NOT NULL DEFAULT '[]',
  active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,user_id), UNIQUE(tenant_id,id)
);
CREATE TABLE sessions (
  token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES identities(id), tenant_id uuid NOT NULL REFERENCES companies(id),
  created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE auth_tokens (
  token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES identities(id), expires_at timestamptz NOT NULL
);
CREATE TABLE rate_limits (key text PRIMARY KEY, count integer NOT NULL, expires_at timestamptz NOT NULL);
CREATE TABLE departments (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES companies(id), name text NOT NULL,
  description text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,name), UNIQUE(tenant_id,id)
);
CREATE TABLE department_members (
  tenant_id uuid NOT NULL, department_id uuid NOT NULL, membership_id uuid NOT NULL,
  PRIMARY KEY(tenant_id,department_id,membership_id),
  FOREIGN KEY(tenant_id,department_id) REFERENCES departments(tenant_id,id) ON DELETE CASCADE,
  FOREIGN KEY(tenant_id,membership_id) REFERENCES memberships(tenant_id,id) ON DELETE CASCADE
);
CREATE TABLE invitations (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES companies(id), email text NOT NULL, role text NOT NULL CHECK(role IN ('admin','supervisor','agent')),
  token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, accepted_at timestamptz, revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id)
);
CREATE UNIQUE INDEX invitations_pending ON invitations(tenant_id,email) WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE TABLE tags (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES companies(id), name text NOT NULL, color text NOT NULL,
  UNIQUE(tenant_id,name), UNIQUE(tenant_id,id)
);
CREATE TABLE contacts (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES companies(id), name text NOT NULL, phone text NOT NULL,
  email text NOT NULL DEFAULT '', notes text NOT NULL DEFAULT '', archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,phone), UNIQUE(tenant_id,id)
);
CREATE INDEX contacts_recent ON contacts(tenant_id,updated_at DESC,id);
CREATE TABLE contact_tags (
  tenant_id uuid NOT NULL, contact_id uuid NOT NULL, tag_id uuid NOT NULL, PRIMARY KEY(tenant_id,contact_id,tag_id),
  FOREIGN KEY(tenant_id,contact_id) REFERENCES contacts(tenant_id,id) ON DELETE CASCADE,
  FOREIGN KEY(tenant_id,tag_id) REFERENCES tags(tenant_id,id) ON DELETE CASCADE
);
CREATE TABLE quick_replies (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES companies(id), shortcut text NOT NULL, title text NOT NULL,
  body text NOT NULL, department_id uuid, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,shortcut), UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,department_id) REFERENCES departments(tenant_id,id)
);
CREATE TABLE followups (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES companies(id), contact_id uuid NOT NULL,
  membership_id uuid NOT NULL, note text NOT NULL, due_at timestamptz NOT NULL, completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id),
  FOREIGN KEY(tenant_id,contact_id) REFERENCES contacts(tenant_id,id),
  FOREIGN KEY(tenant_id,membership_id) REFERENCES memberships(tenant_id,id)
);
CREATE INDEX followups_due ON followups(tenant_id,due_at) WHERE completed_at IS NULL;
CREATE TABLE audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES companies(id),
  actor_id uuid, action text NOT NULL, entity_id text, metadata jsonb NOT NULL DEFAULT '{}', request_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_recent ON audit_events(tenant_id,id DESC);

-- Application connections MUST use caju_app (NOSUPERUSER NOBYPASSRLS).
-- set_config(..., true) scopes the tenant to the current transaction only.
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies FORCE ROW LEVEL SECURITY;
CREATE POLICY company_boundary ON companies USING(id = nullif(current_setting('caju.tenant_id',true),'')::uuid) WITH CHECK(id = nullif(current_setting('caju.tenant_id',true),'')::uuid);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['memberships','departments','department_members','invitations','tags','contacts','contact_tags','quick_replies','followups','audit_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY tenant_boundary ON %I USING (tenant_id = nullif(current_setting(''caju.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''caju.tenant_id'',true),'''')::uuid)',t);
  END LOOP;
END $$;

-- Narrow auth lookup functions return only data required BEFORE tenant selection.
CREATE FUNCTION auth_memberships(uid uuid) RETURNS TABLE(tenant_id uuid, company_name text, role text, active boolean)
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT m.tenant_id,c.name,m.role,m.active AND c.status='active' FROM memberships m JOIN companies c ON c.id=m.tenant_id WHERE m.user_id=uid;
$$;
CREATE FUNCTION auth_invitation(digest text) RETURNS TABLE(id uuid,tenant_id uuid,email text,role text,company_name text)
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT i.id,i.tenant_id,i.email,i.role,c.name FROM invitations i JOIN companies c ON c.id=i.tenant_id
  WHERE i.token_hash=digest AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>now() AND c.status='active';
$$;
REVOKE ALL ON FUNCTION auth_memberships(uuid), auth_invitation(text) FROM PUBLIC;
