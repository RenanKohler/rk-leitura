ALTER TABLE "texts" ADD COLUMN "pace_profile" jsonb;--> statement-breakpoint
-- O perfil de ritmo (US-209) vale para um conteudo: qualquer gravacao que
-- mude o texto, o formato ou o idioma o apaga, e o tempo livre o refaz.
CREATE OR REPLACE FUNCTION texts_clear_pace_profile() RETURNS trigger AS $$
BEGIN
  IF NEW.content IS DISTINCT FROM OLD.content
     OR NEW.format IS DISTINCT FROM OLD.format
     OR NEW.language IS DISTINCT FROM OLD.language THEN
    NEW.pace_profile := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER texts_clear_pace_profile
  BEFORE UPDATE OF content, format, language ON texts
  FOR EACH ROW EXECUTE FUNCTION texts_clear_pace_profile();
