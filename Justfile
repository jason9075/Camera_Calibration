set shell := ["sh", "-c"]

# 啟動開發 server（no-cache, no-browser, port 8080）
dev:
    @echo "\033[36m[Nord] Running gfx-lab dev server...\033[0m"
    live-server --port 8080 .

# 觸發 live-server 重新載入（touch index.html）
refresh:
    @echo "\033[34m[Nord] Triggering workspace refresh...\033[0m"
    touch index.html

# 檢查工具版本
check:
    @live-server --version 2>&1 || true
    @just --version
