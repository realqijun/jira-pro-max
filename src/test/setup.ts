import "dotenv/config";

// Point the shared `db` singleton at the test database before any module imports it.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.STORAGE_DRIVER = "disk";
process.env.STORAGE_DIR = "./.test-storage";

// Tests exercise the deterministic fallbacks: no live model calls and no local binaries.
process.env.OPENAI_API_KEY = "";
process.env.GEMINI_API_KEY = "";
process.env.GOOGLE_GENERATIVE_AI_API_KEY = "";
process.env.LITEPRUNER_API_KEY = "";
process.env.MARKITDOWN_BIN = "/nonexistent/markitdown";
