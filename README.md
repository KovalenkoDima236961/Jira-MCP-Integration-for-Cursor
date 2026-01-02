# Jira MCP Integration for Cursor

A Model Context Protocol (MCP) server that integrates Jira with Cursor IDE, enabling seamless issue management, automatic branch creation, and workflow automation.

## Features

- 🔗 **Jira Integration**: Full integration with Atlassian Jira Cloud via MCP
- 🌿 **Automatic Branch Creation**: Automatically creates GitHub or GitLab branches when creating Jira issues
- 🔄 **Workflow Automation**: Assign issues, transition to review status, and trigger Cursor analysis
- 🌐 **Multi-language Support**: Transliterates non-English characters in branch names to English
- 🎯 **Dual Mode**: Supports both simple (dev) and full-form (prod) issue creation modes
- 🔌 **MCP Server**: Works as an MCP server that Cursor can connect to directly

## Prerequisites

- Node.js 18+ 
- npm or yarn
- Jira Cloud account with API access
- (Optional) GitHub or GitLab account with repository access

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd poc-work-mcp-jira
```

2. Install dependencies:
```bash
npm install
```

3. Build the project:
```bash
npm run build
```

## Configuration

### Environment Variables

Create a `.env` file in the project root with the following variables:

#### Required
- `JIRA_CLOUD_ID` or `CLOUD_ID` - Your Jira Cloud ID (UUID format)

#### Optional - GitHub Integration
- `GITHUB_TOKEN` - GitHub personal access token with `repo` scope
- `GITHUB_REPO` - Repository in format `owner/repo` or full URL
- `GITHUB_DEFAULT_BRANCH` - Default branch name (default: `main`)

#### Optional - Local Git Integration (GitLab/GitHub)
- `GITLAB_DEFAULT_BRANCH` or `GITHUB_DEFAULT_BRANCH` - Default branch name (default: `master`)

**Note:** For local git operations, you don't need GitLab/GitHub tokens. The system automatically uses the current working directory where the command is executed. If you're running the command from Cursor in a project folder, it will automatically use that directory and detect if it's a git repository.


### Example `.env` file:
```env
JIRA_CLOUD_ID=
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
GITHUB_REPO=owner/repository-name
GITHUB_DEFAULT_BRANCH=main
```

## Usage

### As MCP Server (Recommended for Cursor)

1. Configure Cursor to use the MCP server by adding to your Cursor MCP configuration:

```json
{
  "mcpServers": {
    "jira-mcp-poc": {
      "command": "node",
      "args": ["/absolute/path/to/poc-work-mcp-jira/dist/mcp-server.js"],
      "env": {
        "JIRA_CLOUD_ID": "your-cloud-id",
        "GITHUB_TOKEN": "${GITHUB_TOKEN}",
        "GITHUB_REPO": "${GITHUB_REPO}"
      }
    }
  }
}
```

2. Restart Cursor to load the MCP server

3. Use Cursor's AI to interact with Jira:
   - "Create a Jira issue for fixing the login bug"
   - "Assign issue OPS-123 to John"
   - "Move issue OPS-123 to review"

### As CLI Tool

Run the CLI interface:
```bash
npm start
```

Available commands:
- `create-dev` - Create a simple Jira issue (dev mode)
- `create-prod` - Create a full-form Jira issue (prod mode)
- `assign` - Assign an issue to a user
- `review` - Transition an issue to "In Review" status
- `test` - Test MCP connection and configuration

## Available MCP Tools

When connected to Cursor, the following custom tools are available:

### `createJiraIssueWithBranch`

Creates a Jira issue and automatically creates a GitHub/GitLab branch.

**Parameters:**
- `cloudId` (string, required) - Jira Cloud ID
- `projectKey` (string, required) - Project key (e.g., "OPS")
- `issueTypeName` (string, required) - Issue type (Task, Bug, Story, etc.)
- `summary` (string, required) - Issue summary/title
- `description` (string, optional) - Issue description
- `branchName` (string, optional) - Custom branch name (defaults to issue key)
- `mode` (string, optional) - "dev" for simple mode, "prod" for full form
- `fields` (object, optional) - Additional Jira fields (for prod mode)

**Example:**
```json
{
  "cloudId": "98e8fc6d-f50f-44dc-a497-0f45939d8289",
  "projectKey": "OPS",
  "issueTypeName": "Task",
  "summary": "Fix login bug",
  "description": "The login form is not working properly"
}
```

### `assignJiraIssueWithAnalysis`

Assigns a Jira issue to a user and optionally triggers Cursor analysis.

**Parameters:**
- `cloudId` (string, required) - Jira Cloud ID
- `issueIdOrKey` (string, required) - Issue key (e.g., "OPS-123")
- `assignee` (string, required) - Assignee email, accountId, or "unassign"

### `transitionJiraIssueToReview`

Transitions a Jira issue to "In Review" status.

**Parameters:**
- `cloudId` (string, required) - Jira Cloud ID
- `issueIdOrKey` (string, required) - Issue key (e.g., "OPS-123")

### `analyzeJiraIssue`

Analyzes a Jira issue. Automatically creates a branch if it doesn't exist, then prepares the issue for analysis.

**Parameters:**
- `cloudId` (string, required) - Jira Cloud ID
- `issueIdOrKey` (string, required) - Issue key (e.g., "OPS-123")
- `branchName` (string, optional) - Custom branch name (optional, defaults to issue key)

**Example:**
```json
{
  "cloudId": "98e8fc6d-f50f-44dc-a497-0f45939d8289",
  "issueIdOrKey": "OPS-123"
}
```

## GitHub Token Permissions

For GitHub integration, your personal access token needs:
- **Classic tokens**: `repo` scope (full control of private repositories)
- **Fine-grained tokens**: "Read and write" permission for "Contents"

## Local Git Integration

For local git operations (creating branches locally):
- No token required
- The system automatically uses the current working directory
- The system will use local git commands to:
  1. Fetch latest changes from remote
  2. Checkout the default branch
  3. Pull latest changes
  4. Create and switch to the new branch

**Priority:** The system automatically detects if the current working directory is a git repository. If it is, Local Git will be used. Otherwise, GitHub API will be used if credentials are available.

## Project Structure

```
poc-work-mcp-jira/
├── dist/                 # Compiled JavaScript files
├── images/              # Documentation images
├── index.ts             # CLI interface
├── mcp-server.ts        # MCP server implementation
├── cursor-mcp-config.json  # Example Cursor configuration
├── package.json         # Dependencies and scripts
└── README.md           # This file
```

## Development

### Build
```bash
npm run build
```

### Run MCP Server
```bash
npm run mcp-server
```

### Run CLI
```bash
npm start
```

## Troubleshooting

### MCP Connection Issues

1. Verify your `JIRA_CLOUD_ID` is set correctly
2. Check that the MCP server path in Cursor config is absolute
3. Ensure Node.js is in your PATH
4. Check Cursor logs for connection errors

### Branch Creation Fails

**For GitHub API:**
1. Verify GitHub token has correct permissions
2. Check repository format (should be `owner/repo` or full URL)
3. Ensure default branch exists in the repository
4. Check token hasn't expired

**For Local Git:**
1. Ensure you're running the command from a git repository directory
2. Verify the directory contains a `.git` folder (repository is initialized or cloned)
3. Check that you have write permissions to the repository directory
4. Ensure git is installed and available in PATH
5. If using remote, verify remote is configured correctly

### Issue Creation Fails

1. Verify project key exists in your Jira instance
2. Check issue type name is correct for the project
3. Ensure required fields are provided for prod mode
4. Check Jira Cloud ID is correct

## License

ISC

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

