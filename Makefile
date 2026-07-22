# Makefile — one task interface for the "CLI vs MCP vs AXI" talk + demo.
#
# Everything here is OFFLINE except `make agent-run`, which calls a real model
# API (run it before the talk to refresh the recordings — never on stage).
# Run `make` (or `make help`) to list targets. See README.md for what each
# number and artifact means, and which are real measurements vs approximations.

CI := ci-demo

.DEFAULT_GOAL := help
.PHONY: help install build test check viz token-diff capture agent-run validate-recording clean

help: ## List the available targets
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
	  | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'

install: ## Install deps (frozen, offline; links the vendored axi-sdk-js)
	cd $(CI) && pnpm install --frozen-lockfile

build: ## Typecheck + compile TypeScript to dist/  [offline]
	cd $(CI) && pnpm build

test: ## Run the vitest suite, incl. the recording validator  [offline]
	cd $(CI) && pnpm test

check: build test token-diff ## Mirror CI locally: build + test + token-diff smoke  [offline]

viz: ## Serve the interactive demo at http://localhost:5173/viz/  [offline]
	cd $(CI) && pnpm viz

token-diff: build ## Per-call payload diff — gpt-tokenizer APPROXIMATION, not the slide numbers  [offline]
	cd $(CI) && node scripts/token-diff.mjs

capture: build ## Regenerate the captured per-call payloads under ci-demo/out/  [offline]
	cd $(CI) && node scripts/capture.mjs

agent-run: build ## Real agent run -> recordings/ (ONLINE; e.g. make agent-run ARGS="--provider openai --model gpt-4o --record")
	cd $(CI) && pnpm agent-run -- $(ARGS)

validate-recording: ## Validate a recording (usage: make validate-recording REC=recordings/openai-gpt-4o.json)  [offline]
	cd $(CI) && node scripts/validate-recording.mjs $(REC)

clean: ## Remove build output (dist/, out/)
	cd $(CI) && rm -rf dist out
