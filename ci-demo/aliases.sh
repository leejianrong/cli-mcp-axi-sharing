# aliases.sh — short, typo-proof commands for the live demo.
# Source it from ci-demo/:   source aliases.sh
# You're running, not typing much; these keep every command short on the projector.

alias ci-cli='node dist/cli.js'      # the verbose human CLI
alias ci-mcp='node dist/mcp-server.js'  # the MCP stdio server
alias ci='node dist/axi.js'          # the finished AXI command

alias k='clear'
alias cap='node scripts/capture.mjs'   # cap cli | cap mcp | cap axi | cap all
alias t='node scripts/token-diff.mjs'  # the token diff

echo "aliases loaded: ci-cli, ci-mcp, ci, k (clear), cap (capture), t (token-diff)"
