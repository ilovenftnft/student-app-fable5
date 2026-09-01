-- 单文件 SQLite（node:sqlite）。所有路径相对 DATA_DIR。表清单见 AGENTS.md「数据库」。
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS subject (
  id        TEXT PRIMARY KEY,          -- 语文 / 数学 / 英语 / 历史 / 地理 / 生物 / 道法
  name      TEXT NOT NULL,
  sort      INTEGER NOT NULL
);
INSERT OR IGNORE INTO subject (id, name, sort) VALUES
  ('语文','语文',1),('数学','数学',2),('英语','英语',3),('历史','历史',4),
  ('地理','地理',5),('生物','生物',6),('道法','道德与法治',7),('总分','总分',99);

-- 键值设置：content_start（内容启用日 YYYY-MM-DD，intro_day 的第 0 天）、explain_daily_limit 等
CREATE TABLE IF NOT EXISTS setting (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 教材章节树（MVP #2）。parent_id 为空 = 册级
CREATE TABLE IF NOT EXISTS chapter (
  id         TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES subject(id),
  parent_id  TEXT REFERENCES chapter(id),
  title      TEXT NOT NULL,
  sort       INTEGER NOT NULL,
  page       INTEGER,                   -- 教材印刷页
  points     TEXT NOT NULL DEFAULT '[]' -- JSON：本节 3–5 条要点（教材小节标题，带出处），引导式回想用
);

-- 内容项：每条都有出处（硬约束 7）
CREATE TABLE IF NOT EXISTS item (
  id            TEXT PRIMARY KEY,       -- 由内容池确定性生成，重复入库 = 覆盖
  subject_id    TEXT NOT NULL REFERENCES subject(id),
  chapter_id    TEXT REFERENCES chapter(id),
  kind          TEXT NOT NULL CHECK (kind IN ('recitation','concept','vocab','listen','wrong','prestudy')),
  subtype       TEXT NOT NULL,          -- recitation: fill|context；concept: fill|answer_template|gloss；vocab/listen: word；prestudy: definition
  front         TEXT NOT NULL,
  back          TEXT NOT NULL,
  answer_points TEXT,                   -- JSON 数组，answer_template 用
  source_quote  TEXT NOT NULL,          -- 教材原句
  source_ref    TEXT NOT NULL,          -- 册/章/页
  pool          TEXT NOT NULL,          -- standard | textbook
  parent_id     TEXT REFERENCES item(id), -- 情境卡指向其接句卡
  intro_day     INTEGER NOT NULL DEFAULT 0, -- 计划引入日（相对内容启用日，天）
  meta          TEXT NOT NULL DEFAULT '{}', -- JSON：编号、课标原文、音标等
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS item_subject_kind ON item(subject_id, kind);

-- ts-fsrs Card 的落库形态
CREATE TABLE IF NOT EXISTS card_state (
  item_id        TEXT PRIMARY KEY REFERENCES item(id),
  due            TEXT NOT NULL,
  stability      REAL NOT NULL,
  difficulty     REAL NOT NULL,
  elapsed_days   INTEGER NOT NULL,
  scheduled_days INTEGER NOT NULL,
  learning_steps INTEGER NOT NULL DEFAULT 0,
  reps           INTEGER NOT NULL,
  lapses         INTEGER NOT NULL,
  state          INTEGER NOT NULL,      -- 0 New 1 Learning 2 Review 3 Relearning
  last_review    TEXT,
  archived       INTEGER NOT NULL DEFAULT 0,
  pass_streak    INTEGER NOT NULL DEFAULT 0, -- 错题卡：跨会话连续答对次数
  last_pass_session INTEGER REFERENCES session(id) -- 错题卡：最近一次计入答对的会话
);
CREATE INDEX IF NOT EXISTS card_state_due ON card_state(archived, due);

CREATE TABLE IF NOT EXISTS session (
  id          INTEGER PRIMARY KEY,
  date        TEXT NOT NULL UNIQUE,     -- YYYY-MM-DD
  started_at  TEXT NOT NULL,
  ended_at    TEXT,
  minutes     INTEGER,
  ended_by    TEXT                      -- user | hard_stop
);

CREATE TABLE IF NOT EXISTS review (
  id         INTEGER PRIMARY KEY,
  item_id    TEXT NOT NULL REFERENCES item(id),
  session_id INTEGER REFERENCES session(id),
  rating     INTEGER NOT NULL,          -- ts-fsrs Rating 1–4（由 会/不会 + 耗时推断）
  knew       INTEGER NOT NULL,          -- 孩子点的：1 会 0 不会
  elapsed_ms INTEGER NOT NULL,
  reviewed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS review_item ON review(item_id, reviewed_at);

CREATE TABLE IF NOT EXISTS checkin (
  id         INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES session(id),
  chapter_id TEXT NOT NULL REFERENCES chapter(id)
);

-- 引导式回想：勾选章节后默想 1 分钟，展开要点，勾没想起来的
CREATE TABLE IF NOT EXISTS recall (
  id           INTEGER PRIMARY KEY,
  session_id   INTEGER NOT NULL REFERENCES session(id),
  chapter_id   TEXT NOT NULL REFERENCES chapter(id),
  think_ms     INTEGER NOT NULL,        -- 默想用时
  missed       TEXT NOT NULL DEFAULT '[]', -- JSON：没想起来的要点下标
  due_date     TEXT                     -- 勾中的要点次日到期
);

CREATE TABLE IF NOT EXISTS reflection (
  id         INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL UNIQUE REFERENCES session(id),
  hardest    TEXT,                      -- 三问：今天最卡的一点（点选值）
  guessed    TEXT,                      -- 做对的题里哪道是猜的
  tomorrow   TEXT                       -- 明天第一题做什么
);

CREATE TABLE IF NOT EXISTS inbox_photo (
  id         INTEGER PRIMARY KEY,
  path       TEXT NOT NULL UNIQUE,      -- 相对 DATA_DIR
  sha256     TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('queued','running','done','failed','retry_later')),
  attempts   INTEGER NOT NULL DEFAULT 0,
  retry_at   TEXT,
  error      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS problem (
  id           INTEGER PRIMARY KEY,
  photo_id     INTEGER NOT NULL REFERENCES inbox_photo(id),
  subject_id   TEXT REFERENCES subject(id),
  stem         TEXT NOT NULL,
  answer       TEXT,
  tags         TEXT NOT NULL DEFAULT '[]', -- JSON
  needs_figure INTEGER NOT NULL DEFAULT 0,
  crop         TEXT,                    -- JSON bbox
  teacher_mark TEXT,                    -- ✗ / ✓ / null
  confidence   REAL,
  status       TEXT NOT NULL CHECK (status IN ('pending','confirmed','rejected')) DEFAULT 'pending',
  item_id      TEXT REFERENCES item(id),
  raw          TEXT NOT NULL            -- 引擎原始 JSON
);

-- 作答后解锁的讲解（硬约束 2：每日上限，默认 5；只对今天答过的题）
CREATE TABLE IF NOT EXISTS explanation (
  id           INTEGER PRIMARY KEY,
  item_id      TEXT NOT NULL REFERENCES item(id),
  session_id   INTEGER REFERENCES session(id),
  date         TEXT NOT NULL,             -- YYYY-MM-DD，每日计数用
  status       TEXT NOT NULL CHECK (status IN ('queued','running','done','failed')) DEFAULT 'queued',
  text         TEXT,
  thread_id    TEXT,
  error        TEXT,
  requested_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS explanation_date ON explanation(date);

CREATE TABLE IF NOT EXISTS exam_score (
  id         INTEGER PRIMARY KEY,
  date       TEXT NOT NULL,
  name       TEXT NOT NULL,             -- 期中 / 期末 / 月考…
  subject_id TEXT NOT NULL REFERENCES subject(id),
  score      REAL NOT NULL,
  full_score REAL NOT NULL,
  class_rank INTEGER,
  class_size INTEGER,
  grade_rank INTEGER,
  grade_size INTEGER
);
