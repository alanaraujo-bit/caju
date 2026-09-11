ALTER TABLE messages DROP CONSTRAINT messages_kind_check;
ALTER TABLE messages ADD CONSTRAINT messages_kind_check CHECK(kind IN ('text','image','video','audio','document','sticker','location','contact','poll','unknown'));
ALTER TABLE messages ADD COLUMN sender_jid text;
ALTER TABLE messages ADD COLUMN receipted_at timestamptz;
