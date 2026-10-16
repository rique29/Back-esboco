-- =====================================================================
-- Vistorias (checklist de 35 itens), ajustes de 2FA, updated_at e RLS
-- Rode depois da migration "schema_inicial".
-- =====================================================================

-- 1. CATÁLOGO DO CHECKLIST (35 itens)
CREATE TABLE checklist_itens (
    id        SMALLINT PRIMARY KEY CHECK (id BETWEEN 1 AND 35),
    grupo     VARCHAR(60)  NOT NULL,
    descricao VARCHAR(150) NOT NULL
);

INSERT INTO checklist_itens (id, grupo, descricao) VALUES
(1,  'Documentos e segurança',     'CRLV do veículo'),
(2,  'Documentos e segurança',     'CNH do motorista'),
(3,  'Documentos e segurança',     'Extintor (validade e carga)'),
(4,  'Documentos e segurança',     'Triângulo de sinalização'),
(5,  'Documentos e segurança',     'Macaco e chave de roda'),
(6,  'Iluminação e sinalização',   'Faróis'),
(7,  'Iluminação e sinalização',   'Lanternas traseiras'),
(8,  'Iluminação e sinalização',   'Setas e pisca-alerta'),
(9,  'Iluminação e sinalização',   'Luz de freio e de ré'),
(10, 'Iluminação e sinalização',   'Buzina e alarme de ré'),
(11, 'Pneus e rodas',              'Calibragem'),
(12, 'Pneus e rodas',              'Desgaste dos pneus'),
(13, 'Pneus e rodas',              'Estepe'),
(14, 'Pneus e rodas',              'Fixação das rodas'),
(15, 'Freios e direção',           'Freio de serviço'),
(16, 'Freios e direção',           'Freio de estacionamento'),
(17, 'Freios e direção',           'Direção (folgas)'),
(18, 'Freios e direção',           'Suspensão'),
(19, 'Motor e fluidos',            'Óleo do motor'),
(20, 'Motor e fluidos',            'Líquido de arrefecimento'),
(21, 'Motor e fluidos',            'Óleo hidráulico'),
(22, 'Motor e fluidos',            'Fluido de freio'),
(23, 'Motor e fluidos',            'Vazamentos'),
(24, 'Motor e fluidos',            'Correias e mangueiras'),
(25, 'Cabine e painel',            'Luzes de alerta do painel'),
(26, 'Cabine e painel',            'Cinto de segurança'),
(27, 'Cabine e painel',            'Retrovisores'),
(28, 'Cabine e painel',            'Limpador e lavador de para-brisa'),
(29, 'Carroceria e equipamento',   'Sistema de compactação/caçamba'),
(30, 'Carroceria e equipamento',   'Travas e portas'),
(31, 'Carroceria e equipamento',   'Plataforma e estribos dos coletores'),
(32, 'Carroceria e equipamento',   'Vedação (chorume)'),
(33, 'Geral',                      'Limpeza da cabine'),
(34, 'Geral',                      'Nível de combustível'),
(35, 'Geral',                      'Estado geral da lataria');

-- 2. VISTORIAS (cabeçalho)
CREATE TABLE vistorias (
    id                 SERIAL PRIMARY KEY,
    equipamento_id     INTEGER REFERENCES equipamentos_frota(id) ON DELETE SET NULL,
    placa              VARCHAR(15) NOT NULL,
    data_vistoria      DATE NOT NULL,
    hora_vistoria      TIME,
    horimetro_km       NUMERIC(12,2) CHECK (horimetro_km >= 0),
    observacoes_gerais TEXT,  -- guardado criptografado (AES-256-GCM) pela API
    resultado          VARCHAR(10) NOT NULL CHECK (resultado IN ('APROVADO', 'REPROVADO')),
    vistoriador_id     INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    created_at         TIMESTAMPTZ DEFAULT NOW(),
    updated_at         TIMESTAMPTZ DEFAULT NOW()
);

-- 3. RESPOSTAS (uma linha por item do checklist)
CREATE TABLE vistoria_respostas (
    id          SERIAL PRIMARY KEY,
    vistoria_id INTEGER  NOT NULL REFERENCES vistorias(id) ON DELETE CASCADE,
    item_id     SMALLINT NOT NULL REFERENCES checklist_itens(id),
    resultado   VARCHAR(2) NOT NULL CHECK (resultado IN ('C', 'NC', 'NA')),
    observacao  TEXT,  -- guardado criptografado (AES-256-GCM) pela API
    UNIQUE (vistoria_id, item_id)
);

CREATE INDEX idx_vistorias_data_placa ON vistorias(data_vistoria DESC, placa);
CREATE INDEX idx_vistorias_resultado  ON vistorias(resultado);
CREATE INDEX idx_vistoria_respostas_vistoria ON vistoria_respostas(vistoria_id);

-- 4. 2FA: limite de tentativas por código
ALTER TABLE codigos_verificacao ADD COLUMN tentativas SMALLINT NOT NULL DEFAULT 0;
CREATE INDEX idx_codigos_usuario_final ON codigos_verificacao(usuario_id, finalidade, utilizado);

-- 5. updated_at automático
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_usuarios_updated        BEFORE UPDATE ON usuarios           FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_equipamentos_updated    BEFORE UPDATE ON equipamentos_frota FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_ordens_servico_updated  BEFORE UPDATE ON ordens_servico     FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_itens_estoque_updated   BEFORE UPDATE ON itens_estoque      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_vistorias_updated       BEFORE UPDATE ON vistorias          FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 6. SEGURANÇA: liga RLS em TODAS as tabelas do schema public.
-- No Supabase, tabelas do schema public ficam expostas na API REST. Sem RLS,
-- quem tiver a chave "anon" poderia ler tudo (inclusive senha_hash).
-- Sem nenhuma policy criada, só o backend (chave service_role) acessa os dados.
DO $$
DECLARE t RECORD;
BEGIN
    FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
    END LOOP;
END $$;
