# Jira MCP Integration for Cursor

A Model Context Protocol (MCP) server that integrates Jira with Cursor IDE, enabling seamless issue management, automatic branch creation, and workflow automation.

## Features

- 🔗 **Jira Integration**: Full integration with both Jira Cloud (via MCP) and Jira Data Center (on-premise via REST API)
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

#### Required (choose one)

**For Jira Cloud:**
- `JIRA_CLOUD_ID` or `CLOUD_ID` - Your Jira Cloud ID (UUID format)

**For Jira Data Center (on-premise):**
- `JIRA_BASE_URL` - Your Jira instance URL (e.g., `https://jira.service.snpgroup.com`)
- `JIRA_PERSONAL_ACCESS_TOKEN` - Personal Access Token for authentication (recommended, uses Bearer auth)
- OR `JIRA_API_TOKEN` + `JIRA_USERNAME`/`JIRA_EMAIL` - Legacy API Token with username/email (uses Basic Auth)

#### Optional - GitHub Integration
- `GITHUB_TOKEN` - GitHub personal access token with `repo` scope
- `GITHUB_REPO` - Repository in format `owner/repo` or full URL
- `GITHUB_DEFAULT_BRANCH` - Default branch name (default: `main`)

#### Optional - Local Git Integration (GitLab/GitHub)
- `GITLAB_DEFAULT_BRANCH` or `GITHUB_DEFAULT_BRANCH` - Default branch name (default: `master`)

**Note:** For local git operations, you don't need GitLab/GitHub tokens. The system automatically uses the current working directory where the command is executed. If you're running the command from Cursor in a project folder, it will automatically use that directory and detect if it's a git repository.


### Example `.env` file:

**For Jira Cloud:**
```env
JIRA_CLOUD_ID=
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
GITHUB_REPO=owner/repository-name
GITHUB_DEFAULT_BRANCH=main
```

**For Jira Data Center (with Personal Access Token - recommended):**
```env
JIRA_BASE_URL=https://jira.service.snpgroup.com
JIRA_PERSONAL_ACCESS_TOKEN=your-personal-access-token
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
GITHUB_REPO=owner/repository-name
GITHUB_DEFAULT_BRANCH=main
```

**For Jira Data Center (with Legacy API Token):**
```env
JIRA_BASE_URL=https://jira.service.snpgroup.com
JIRA_API_TOKEN=your-api-token
JIRA_USERNAME=your-email@example.com
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
      "args": ["${MCP_SERVER_PATH}"],
      "env": {
        "JIRA_CLOUD_ID": "${JIRA_CLOUD_ID}",
        "JIRA_BASE_URL": "${JIRA_BASE_URL}",
        "JIRA_API_TOKEN": "${JIRA_API_TOKEN}",
        "JIRA_USERNAME": "${JIRA_USERNAME}",
        "GITHUB_TOKEN": "${GITHUB_TOKEN}",
        "GITHUB_REPO": "${GITHUB_REPO}",
        "GITHUB_DEFAULT_BRANCH": "${GITHUB_DEFAULT_BRANCH}"
      }
    }
  }
}
```

**Note:** 
- Use `JIRA_CLOUD_ID` for Jira Cloud, or `JIRA_BASE_URL` + `JIRA_PERSONAL_ACCESS_TOKEN` (recommended) or `JIRA_BASE_URL` + `JIRA_API_TOKEN` + `JIRA_USERNAME` (legacy) for Jira Data Center
- `MCP_SERVER_PATH` should point to the absolute path of `dist/mcp-server.js` (e.g., `/absolute/path/to/poc-work-mcp-jira/dist/mcp-server.js`)
- All values use environment variables for security and flexibility
- For Personal Access Token, only `JIRA_PERSONAL_ACCESS_TOKEN` is needed (no username/email required)

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

Creates a Jira issue and automatically creates a GitHub/GitLab branch. Works with both **Jira Cloud** and **Jira Data Center**.

**Parameters:**
- `cloudId` (string, optional) - Jira Cloud ID (only needed for Cloud, will use `JIRA_CLOUD_ID` env var if not provided). For Data Center, set `JIRA_BASE_URL` env var instead.
- `projectKey` (string, required) - Project key (e.g., "OPS")
- `issueTypeName` (string, required) - Issue type (Task, Bug, Story, etc.)
- `summary` (string, required) - Issue summary/title
- `description` (string, optional) - Issue description
- `branchName` (string, optional) - Custom branch name (defaults to issue key)
- `fields` (object, optional) - Additional Jira fields

**Example for Jira Cloud:**
```json
{
  "projectKey": "OPS",
  "issueTypeName": "Task",
  "summary": "Fix login bug",
  "description": "The login form is not working properly"
}
```

**Example for Jira Data Center:**
```json
{
  "projectKey": "OPS",
  "issueTypeName": "Task",
  "summary": "Fix login bug",
  "description": "The login form is not working properly"
}
```

**Note:** The system automatically detects whether you're using Cloud or Data Center based on environment variables (`JIRA_CLOUD_ID` for Cloud, `JIRA_BASE_URL` for Data Center). You don't need to specify `cloudId` in the request if environment variables are properly configured.

### `assignJiraIssueWithAnalysis`

Assigns a Jira issue to a user and optionally triggers Cursor analysis. Works with both **Jira Cloud** and **Jira Data Center**.

**Parameters:**
- `cloudId` (string, optional) - Jira Cloud ID (only needed for Cloud, will use `JIRA_CLOUD_ID` env var if not provided). For Data Center, set `JIRA_BASE_URL` env var instead.
- `issueIdOrKey` (string, required) - Issue key (e.g., "OPS-123")
- `assignee` (string, required) - Assignee email, accountId, or "unassign"

### `transitionJiraIssueToReview`

Transitions a Jira issue to "In Review" status. Works with both **Jira Cloud** and **Jira Data Center**.

**Parameters:**
- `cloudId` (string, optional) - Jira Cloud ID (only needed for Cloud, will use `JIRA_CLOUD_ID` env var if not provided). For Data Center, set `JIRA_BASE_URL` env var instead.
- `issueIdOrKey` (string, required) - Issue key (e.g., "OPS-123")

### `analyzeJiraIssue`

Analyzes a Jira issue. Automatically creates a branch if it doesn't exist, then prepares the issue for analysis. Works with both **Jira Cloud** and **Jira Data Center**.

**Parameters:**
- `cloudId` (string, optional) - Jira Cloud ID (only needed for Cloud, will use `JIRA_CLOUD_ID` env var if not provided). For Data Center, set `JIRA_BASE_URL` env var instead.
- `issueIdOrKey` (string, required) - Issue key (e.g., "OPS-123")
- `branchName` (string, optional) - Custom branch name (optional, defaults to issue key)

**Example:**
```json
{
  "issueIdOrKey": "OPS-123"
}
```

**Note:** For Data Center, `cloudId` is not needed if environment variables are properly configured.

### Standard Tools

The following standard Jira tools are also available (automatically detected based on your Jira type):

- `getJiraIssue` - Get a Jira issue by issue id or key
- `createJiraIssue` - Create a Jira issue (without branch creation)
- `editJiraIssue` - Edit a Jira issue. Use `fields` to update issue fields, and `update` to add comments, worklogs, etc.
- `getTransitionsForJiraIssue` - Get available transitions for a Jira issue
- `transitionJiraIssue` - Transition a Jira issue to a different status
- `getVisibleJiraProjects` - Get list of visible Jira projects
- `addCommentToJiraIssue` - Add a comment to a Jira issue

**Example - Adding a comment via editJiraIssue:**
```json
{
  "issueIdOrKey": "OPS-123",
  "update": {
    "comment": [
      {
        "add": {
          "body": "This is a comment"
        }
      }
    ]
  }
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
├── Dockerfile           # Docker build configuration
├── .dockerignore        # Docker ignore patterns
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

### Build with Docker

You can compile the project using Docker:

**Build the Docker image:**
```bash
docker build -t jira-mcp-poc .
```

**Build and copy compiled files to local directory:**
```bash
# Build the image
docker build -t jira-mcp-poc .

# Copy the compiled dist/ folder from the container
docker create --name temp-container jira-mcp-poc
docker cp temp-container:/app/dist ./dist
docker rm temp-container
```

**Or build only (compile without creating runtime image):**
```bash
# Build stage only - compiles TypeScript
docker build --target builder -t jira-mcp-poc:builder .

# Copy compiled files
docker create --name temp-container jira-mcp-poc:builder
docker cp temp-container:/app/dist ./dist
docker rm temp-container
```

The Dockerfile uses a multi-stage build:
- **Builder stage**: Installs all dependencies (including dev dependencies) and compiles TypeScript
- **Final stage**: Creates a production-ready image with only runtime dependencies

## Jira Data Center Setup

For Jira Data Center (on-premise), you need to:

1. **Create a Personal Access Token:**
   - Go to your Jira instance
   - Navigate to Account Settings → Security → API Tokens (or Personal Access Tokens)
   - Create a new token
   - Copy the token

2. **Configure environment variables:**

   **For Personal Access Token (recommended):**
   ```env
   JIRA_BASE_URL=https://your-jira-instance.com
   JIRA_PERSONAL_ACCESS_TOKEN=your-personal-access-token
   ```
   
   **For Legacy API Token:**
   ```env
   JIRA_BASE_URL=https://your-jira-instance.com
   JIRA_API_TOKEN=your-api-token
   JIRA_USERNAME=your-email@example.com
   ```

3. **Note:** The system automatically detects whether you're using Cloud or Data Center:
   - If `JIRA_BASE_URL` is set → Data Center mode
   - If `JIRA_CLOUD_ID` is set → Cloud mode

## Troubleshooting

### MCP Connection Issues

**For Jira Cloud:**
1. Verify your `JIRA_CLOUD_ID` is set correctly
2. Check that the MCP server path in Cursor config is absolute
3. Ensure Node.js is in your PATH
4. Check Cursor logs for connection errors

**For Jira Data Center:**
1. Verify your `JIRA_BASE_URL` is correct (should be the base URL without `/rest/api`)
2. For Personal Access Token: Check that `JIRA_PERSONAL_ACCESS_TOKEN` is set correctly (username/email not required)
3. For Legacy API Token: Check that `JIRA_API_TOKEN` and `JIRA_USERNAME`/`JIRA_EMAIL` are set correctly
4. Ensure your Personal Access Token or API Token has the necessary permissions
5. Test the connection by accessing `https://your-jira-instance.com/rest/api/2/serverInfo` with your credentials

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

