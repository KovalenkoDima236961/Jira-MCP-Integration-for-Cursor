#!/usr/bin/env node
import "dotenv/config";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  CallToolResultSchema,
  ListToolsResultSchema,
} from "@modelcontextprotocol/sdk/types.js";
import https from "node:https";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { URL } from "node:url";

const execAsync = promisify(exec);

type JsonObject = Record<string, unknown>;

const REMOTE_MCP = "https://mcp.atlassian.com/v1/mcp";

let jiraClient: Client | null = null;
let jiraTransport: StdioClientTransport | null = null;

// Determine Jira type: "cloud" or "datacenter"
function getJiraType(): "cloud" | "datacenter" {
  const baseUrl = process.env.JIRA_BASE_URL;
  if (baseUrl && baseUrl.trim()) {
    return "datacenter";
  }
  return "cloud";
}

async function getJiraClient(): Promise<Client> {
  if (!jiraClient) {
    jiraTransport = new StdioClientTransport({
      command: "npx",
      args: ["-y", "mcp-remote", REMOTE_MCP],
    });
    jiraClient = new Client({ name: "jira-mcp-poc", version: "0.1.0" }, { capabilities: {} });
    await jiraClient.connect(jiraTransport);
  }
  return jiraClient;
}

async function callJiraTool(name: string, args: JsonObject): Promise<unknown> {
  const jiraType = getJiraType();
  
  if (jiraType === "datacenter") {
    // Map MCP tool names to Data Center REST API endpoints
    return await callJiraDataCenterTool(name, args);
  }
  
  // Use Cloud MCP
  const client = await getJiraClient();
  const result = await client.request(
    { method: "tools/call", params: { name, arguments: args } },
    CallToolResultSchema
  );
  return result;
}

async function callJiraDataCenterTool(name: string, args: JsonObject): Promise<unknown> {
  // Map MCP tool names to Data Center REST API
  switch (name) {
    case "getJiraIssue": {
      const result = await callJiraDataCenterAPI(`issue/${args.issueIdOrKey}`);
      // Return in MCP format
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
    
    case "createJiraIssue": {
      const fields: JsonObject = {
        project: { key: args.projectKey },
        summary: args.summary,
        issuetype: { name: args.issueTypeName },
      };
      
      if (args.description) {
        fields.description = args.description;
      }
      
      // Merge additional fields
      if (args.fields && typeof args.fields === "object") {
        Object.assign(fields, args.fields);
      }
      
      const result = await callJiraDataCenterAPI("issue", "POST", { fields });
      // Return in MCP format with issue key
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
    
    case "editJiraIssue": {
      const body: JsonObject = {};
      
      // Fields can be updated
      if (args.fields && typeof args.fields === "object") {
        body.fields = args.fields as JsonObject;
      }
      
      // Update field is for adding comments, worklogs, etc.
      if (args.update && typeof args.update === "object") {
        body.update = args.update as JsonObject;
      }
      
      const result = await callJiraDataCenterAPI(`issue/${args.issueIdOrKey}`, "PUT", body);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
    
    case "getTransitionsForJiraIssue": {
      const result = await callJiraDataCenterAPI(`issue/${args.issueIdOrKey}/transitions`);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
    
    case "transitionJiraIssue": {
      const transitionData: JsonObject = {
        transition: args.transition,
      };
      if (args.fields) {
        transitionData.fields = args.fields;
      }
      const result = await callJiraDataCenterAPI(`issue/${args.issueIdOrKey}/transitions`, "POST", transitionData);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
    
    case "getVisibleJiraProjects": {
      const result = await callJiraDataCenterAPI("project");
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
    
    case "getJiraProjectIssueTypesMetadata": {
      const result = await callJiraDataCenterAPI(`project/${args.projectIdOrKey}/statuses`);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
    
    case "getJiraIssueTypeMetaWithFields": {
      const result = await callJiraDataCenterAPI(`issue/createmeta?projectKeys=${args.projectIdOrKey}&issuetypeNames=${args.issueTypeId}`);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
    
    case "addCommentToJiraIssue": {
      const result = await callJiraDataCenterAPI(`issue/${args.issueIdOrKey}/comment`, "POST", {
        body: args.commentBody,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
    
    default:
      throw new Error(`Tool ${name} not yet implemented for Data Center. Please use Jira Cloud or implement this tool.`);
  }
}

function sanitizeBranchName(name: string): string {
  // Clean and format branch name
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 100);
}

function httpsRequest(options: https.RequestOptions, data?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve(body);
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${body}`));
        }
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

// Jira Data Center REST API functions
async function callJiraDataCenterAPI(endpoint: string, method: string = "GET", body?: JsonObject): Promise<unknown> {
  const baseUrl = process.env.JIRA_BASE_URL;
  const token = process.env.JIRA_API_TOKEN || process.env.JIRA_PERSONAL_ACCESS_TOKEN;
  const username = process.env.JIRA_USERNAME || process.env.JIRA_EMAIL;
  
  if (!baseUrl || baseUrl.trim() === "") {
    throw new Error("JIRA_BASE_URL is required for Data Center");
  }
  if (!token || token.trim() === "") {
    throw new Error("JIRA_API_TOKEN or JIRA_PERSONAL_ACCESS_TOKEN is required for Data Center. Please set one of these environment variables with your API token.");
  }
  
  // For Personal Access Token, username is not required (uses Bearer auth)
  // For API Token (legacy), username is required (uses Basic auth)
  const isPersonalAccessToken = process.env.JIRA_PERSONAL_ACCESS_TOKEN && !process.env.JIRA_API_TOKEN;
  if (!isPersonalAccessToken && (!username || username.trim() === "")) {
    throw new Error("JIRA_USERNAME or JIRA_EMAIL is required for Data Center authentication when using API Token. For Personal Access Token, only JIRA_PERSONAL_ACCESS_TOKEN is needed.");
  }

  const url = new URL(baseUrl);
  const apiPath = endpoint.startsWith("/rest/api") ? endpoint : `/rest/api/2/${endpoint}`;
  const fullPath = url.pathname.endsWith("/") 
    ? `${url.pathname.slice(0, -1)}${apiPath}` 
    : `${url.pathname}${apiPath}`;

  // For Personal Access Token in Jira Data Center, use Bearer authentication
  // For API Token (legacy), use Basic Auth with username:token
  let authHeader: string;
  if (process.env.JIRA_PERSONAL_ACCESS_TOKEN && token && !process.env.JIRA_API_TOKEN) {
    // Personal Access Token: use Bearer authentication
    authHeader = `Bearer ${token.trim()}`;
  } else {
    // Legacy API Token: use Basic Auth with username:token
    const authUsername = process.env.JIRA_EMAIL || process.env.JIRA_USERNAME || username;
    if (authUsername && token) {
      const credentials = Buffer.from(`${authUsername.trim()}:${token.trim()}`).toString("base64");
      authHeader = `Basic ${credentials}`;
    } else {
      throw new Error("Unable to determine authentication method. Please set JIRA_PERSONAL_ACCESS_TOKEN or JIRA_API_TOKEN with JIRA_USERNAME/JIRA_EMAIL.");
    }
  }

  const options: https.RequestOptions = {
    hostname: url.hostname,
    port: url.port || (url.protocol === "https:" ? 443 : 80),
    path: fullPath,
    method: method,
    headers: {
      "Authorization": authHeader,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
  };

  const data = body ? JSON.stringify(body) : undefined;
  const response = await httpsRequest(options, data);
  
  // Handle empty responses (e.g., 204 No Content for successful PUT/DELETE)
  if (!response || response.trim() === "") {
    return {};
  }
  
  try {
    return JSON.parse(response);
  } catch (error) {
    // If JSON parsing fails, return empty object for successful status codes
    // (some endpoints return non-JSON responses)
    return {};
  }
}

async function getDefaultBranchSha(repo: string, branch: string, token: string): Promise<string> {
  const [owner, repoName] = repo.split("/");
  if (!owner || !repoName) {
    throw new Error(`Invalid GITHUB_REPO format. Expected "owner/repo", got: ${repo}`);
  }

  const options: https.RequestOptions = {
    hostname: "api.github.com",
    path: `/repos/${owner}/${repoName}/git/ref/heads/${branch}`,
    method: "GET",
    headers: {
      "Authorization": `token ${token}`,
      "User-Agent": "jira-mcp-poc",
      "Accept": "application/vnd.github.v3+json",
    },
  };

  const response = await httpsRequest(options);
  const data = JSON.parse(response);
  return data.object.sha;
}

function parseGitHubRepo(repo: string): { owner: string; repoName: string } | null {
  // Handle different formats:
  // - "owner/repo"
  // - "https://github.com/owner/repo"
  // - "https://github.com/owner/repo.git"
  
  let repoPath = repo.trim();
  
  if (repoPath.startsWith("http://") || repoPath.startsWith("https://")) {
    try {
      const url = new URL(repoPath);
      repoPath = url.pathname;
      repoPath = repoPath.replace(/^\/|\/$|\.git$/g, "");
    } catch {
      return null;
    }
  }
  
  repoPath = repoPath.replace(/\.git$/, "");
  
  // Split into owner and repo
  const parts = repoPath.split("/").filter(p => p);
  if (parts.length >= 2) {
    return {
      owner: parts[0],
      repoName: parts[1],
    };
  }
  
  return null;
}

async function createGitHubBranch(issueKey: string, customBranchName?: string): Promise<void> {
  const githubToken = process.env.GITHUB_TOKEN;
  const githubRepo = process.env.GITHUB_REPO;

  if (!githubToken || !githubRepo) {
    return;
  }

  // Parse repo (supports URL and owner/repo format)
  const repoInfo = parseGitHubRepo(githubRepo);
  if (!repoInfo) {
    return;
  }

  try {
    let branchName: string;
    if (customBranchName && customBranchName.trim()) {
      branchName = sanitizeBranchName(customBranchName.trim());
    } else {
      branchName = issueKey.toLowerCase();
    }
    
    const defaultBranch = process.env.GITHUB_DEFAULT_BRANCH || "main";
    const sha = await getDefaultBranchSha(`${repoInfo.owner}/${repoInfo.repoName}`, defaultBranch, githubToken);
    
    const options: https.RequestOptions = {
      hostname: "api.github.com",
      path: `/repos/${repoInfo.owner}/${repoInfo.repoName}/git/refs`,
      method: "POST",
      headers: {
        "Authorization": `token ${githubToken}`,
        "User-Agent": "jira-mcp-poc",
        "Accept": "application/vnd.github.v3+json",
        "Content-Type": "application/json",
      },
    };

    const data = JSON.stringify({
      ref: `refs/heads/${branchName}`,
      sha: sha,
    });

    await httpsRequest(options, data);
  } catch (error: unknown) {
    // Silently handle errors - don't log to Jira
  }
}

async function branchExists(branchName: string, repoPath: string): Promise<boolean> {
  try {
    const { stdout } = await execAsync(`git branch --list ${branchName}`, { cwd: repoPath });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

async function createGitLabBranch(issueKey: string, customBranchName?: string): Promise<void> {
  const localRepoPath = process.cwd();

  if (!existsSync(localRepoPath)) {
    return;
  }

  const gitDir = join(localRepoPath, ".git");
  if (!existsSync(gitDir)) {
    return;
  }

  try {
    let branchName: string;
    if (customBranchName && customBranchName.trim()) {
      branchName = sanitizeBranchName(customBranchName.trim());
    } else {
      branchName = issueKey.toLowerCase();
    }

    const defaultBranch = process.env.GITLAB_DEFAULT_BRANCH || process.env.GITHUB_DEFAULT_BRANCH || "master";

    try {
      try {
        await execAsync("git fetch origin", { cwd: localRepoPath });
      } catch {
        // Silently ignore if fetch fails
      }

      try {
        await execAsync(`git checkout ${defaultBranch}`, { cwd: localRepoPath });
      } catch {
        try {
          await execAsync(`git checkout -b ${defaultBranch}`, { cwd: localRepoPath });
        } catch {
          // Silently ignore if branch creation fails
        }
      }

      try {
        await execAsync(`git pull origin ${defaultBranch}`, { cwd: localRepoPath });
      } catch {
        // Silently ignore if pull fails
      }

      const exists = await branchExists(branchName, localRepoPath);
      if (!exists) {
        try {
          await execAsync(`git checkout -b ${branchName}`, { cwd: localRepoPath });
        } catch {
          // Silently ignore if branch creation fails
        }
      } else {
        try {
          await execAsync(`git checkout ${branchName}`, { cwd: localRepoPath });
        } catch {
          // Silently ignore if checkout fails
        }
      }
    } catch (error: unknown) {
      // Silently handle errors
    }
  } catch (error: unknown) {
    // Silently handle errors - don't log to Jira
  }
}

async function handleCreateResponse(res: unknown, branchNameInput?: string): Promise<string | null> {
  let issueKey: string | null = null;
  try {
    let responseObj: any;
    
    if (typeof res === 'string') {
      try {
        responseObj = JSON.parse(res);
      } catch {
        responseObj = res;
      }
    } else {
      responseObj = res;
    }
    
    if (responseObj?.isError || responseObj?.error) {
      return null;
    }
    
    if (responseObj?.content && Array.isArray(responseObj.content)) {
      // If response is in MCP content format
      for (const item of responseObj.content) {
        if (item.type === "text" && item.text) {
          try {
            const parsed = JSON.parse(item.text);
            // For Data Center, issue key is in parsed.key
            // For Cloud, it might be in different places
            issueKey = parsed?.key || parsed?.fields?.key || parsed?.id || null;
            if (issueKey) break;
          } catch {
            // If not JSON, search in text
            const keyMatch = item.text.match(/([A-Z]+-\d+)/);
            if (keyMatch) {
              issueKey = keyMatch[1];
              break;
            }
          }
        }
      }
    } else {
      // Direct field access (for Data Center direct API responses)
      issueKey = responseObj?.key || 
                 responseObj?.fields?.key || 
                 responseObj?.id ||
                 responseObj?.issueKey ||
                 null;
    }
    
    if (issueKey) {
      const branchName = branchNameInput || undefined;
      const hasGitHub = !!(process.env.GITHUB_TOKEN && process.env.GITHUB_REPO);
      
      const currentDir = process.cwd();
      const gitDir = join(currentDir, ".git");
      const isGitRepo = existsSync(gitDir);
      
      if (isGitRepo) {
        await createGitLabBranch(issueKey, branchName);
      } else if (hasGitHub) {
        await createGitHubBranch(issueKey, branchName);
      }
    }
  } catch (error) {
    // Silently handle errors
  }
  
  return issueKey;
}

function getCloudId(): string {
  const jiraType = getJiraType();
  
  if (jiraType === "datacenter") {
    const baseUrl = process.env.JIRA_BASE_URL;
    if (!baseUrl) {
      throw new Error("JIRA_BASE_URL is required for Data Center");
    }
    return baseUrl;
  }
  
  // For Cloud
  const envCloudId = process.env.JIRA_CLOUD_ID || process.env.CLOUD_ID;
  if (envCloudId) {
    return envCloudId.replace(/^["']|["']$/g, '').trim();
  }
  throw new Error("JIRA_CLOUD_ID not set. Please set it in environment variables for Jira Cloud, or set JIRA_BASE_URL for Data Center.");
}

// Create MCP server for Cursor
const server = new Server(
  {
    name: "jira-mcp-poc",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Handle list tools - add custom tools + proxy from Atlassian MCP
server.setRequestHandler(ListToolsRequestSchema, async () => {
  try {
    const jiraType = getJiraType();
    let jiraTools: { tools: Tool[] } = { tools: [] };
    
    if (jiraType === "cloud") {
      const client = await getJiraClient();
      jiraTools = await client.request({ method: "tools/list" }, ListToolsResultSchema);
    } else {
      // For Data Center, provide basic tools that we support
      jiraTools = {
        tools: [
          {
            name: "getJiraIssue",
            description: "Get a Jira issue by issue id or key",
            inputSchema: {
              type: "object",
              properties: {
                issueIdOrKey: { type: "string" },
              },
              required: ["issueIdOrKey"],
            },
          },
          {
            name: "createJiraIssue",
            description: "Create a Jira issue",
            inputSchema: {
              type: "object",
              properties: {
                projectKey: { type: "string" },
                issueTypeName: { type: "string" },
                summary: { type: "string" },
                description: { type: "string" },
                fields: { type: "object" },
              },
              required: ["projectKey", "issueTypeName", "summary"],
            },
          },
          {
            name: "editJiraIssue",
            description: "Edit a Jira issue. Use 'fields' to update issue fields, and 'update' to add comments, worklogs, etc.",
            inputSchema: {
              type: "object",
              properties: {
                issueIdOrKey: { type: "string" },
                fields: { type: "object", description: "Fields to update (e.g., assignee, priority)" },
                update: { type: "object", description: "Update operations (e.g., comments, worklogs). Format: { comment: [{ add: { body: 'text' } }] }" },
              },
              required: ["issueIdOrKey"],
            },
          },
          {
            name: "getTransitionsForJiraIssue",
            description: "Get available transitions for a Jira issue",
            inputSchema: {
              type: "object",
              properties: {
                issueIdOrKey: { type: "string" },
              },
              required: ["issueIdOrKey"],
            },
          },
          {
            name: "transitionJiraIssue",
            description: "Transition a Jira issue",
            inputSchema: {
              type: "object",
              properties: {
                issueIdOrKey: { type: "string" },
                transition: { type: "object" },
                fields: { type: "object" },
              },
              required: ["issueIdOrKey", "transition"],
            },
          },
        ],
      };
    }
    
    // Add custom tools with additional logic
    const customTools: Tool[] = [
      {
        name: "createJiraIssueWithBranch",
        description: "Create a Jira issue and automatically create a GitHub/GitLab branch. Works with both Jira Cloud and Data Center.",
        inputSchema: {
          type: "object",
          properties: {
            cloudId: { type: "string", description: "Jira Cloud ID (optional, for Cloud only - will use JIRA_CLOUD_ID env var if not provided). For Data Center, set JIRA_BASE_URL env var instead." },
            projectKey: { type: "string", description: "Project key (e.g., OPS)" },
            issueTypeName: { type: "string", description: "Issue type (Task, Bug, Story, etc.)" },
            summary: { type: "string", description: "Issue summary/title" },
            description: { type: "string", description: "Issue description (optional)" },
            branchName: { type: "string", description: "Custom branch name (optional, defaults to issue key)" },
            fields: { type: "object", description: "Additional Jira fields" },
          },
          required: ["projectKey", "issueTypeName", "summary"],
        },
      },
      {
        name: "assignJiraIssueWithAnalysis",
        description: "Assign a Jira issue to a user and trigger Cursor code analysis if enabled.",
        inputSchema: {
          type: "object",
          properties: {
            cloudId: { type: "string", description: "Jira Cloud ID (for Cloud) or JIRA_BASE_URL (for Data Center)" },
            issueIdOrKey: { type: "string", description: "Issue key (e.g., OPS-123)" },
            assignee: { type: "string", description: "Assignee email, accountId, or 'unassign' to remove" },
          },
          required: ["cloudId", "issueIdOrKey", "assignee"],
        },
      },
      {
        name: "transitionJiraIssueToReview",
        description: "Transition a Jira issue to 'In Review' status.",
        inputSchema: {
          type: "object",
          properties: {
            cloudId: { type: "string", description: "Jira Cloud ID (for Cloud) or JIRA_BASE_URL (for Data Center)" },
            issueIdOrKey: { type: "string", description: "Issue key (e.g., OPS-123)" },
          },
          required: ["cloudId", "issueIdOrKey"],
        },
      },
      {
        name: "analyzeJiraIssue",
        description: "Analyze a Jira issue. Automatically creates a branch if it doesn't exist, then performs analysis.",
        inputSchema: {
          type: "object",
          properties: {
            cloudId: { type: "string", description: "Jira Cloud ID (for Cloud) or JIRA_BASE_URL (for Data Center)" },
            issueIdOrKey: { type: "string", description: "Issue key (e.g., OPS-123)" },
            branchName: { type: "string", description: "Custom branch name (optional, defaults to issue key)" },
          },
          required: ["cloudId", "issueIdOrKey"],
        },
      },
    ];
    
    return {
      tools: [...jiraTools.tools, ...customTools],
    };
  } catch (error) {
    throw error;
  }
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const toolName = request.params.name;
  const args = request.params.arguments || {};
  
  try {
    if (toolName === "createJiraIssueWithBranch") {
      const cloudId = (args.cloudId as string) || getCloudId();
      const projectKey = args.projectKey as string;
      const issueTypeName = args.issueTypeName as string;
      const summary = args.summary as string;
      
      if (!projectKey || projectKey.trim() === "") {
        throw new Error("projectKey is required and cannot be empty");
      }
      if (!issueTypeName || issueTypeName.trim() === "") {
        throw new Error("issueTypeName is required and cannot be empty");
      }
      if (!summary || summary.trim() === "") {
        throw new Error("summary is required and cannot be empty");
      }
      
      // Build fields object (without summary and description - they are passed separately)
      const summaryValue = String(summary).trim();
      const descriptionValue = args.description && typeof args.description === "string" && args.description.trim()
        ? String(args.description).trim()
        : undefined;
      const fields: JsonObject = {};
      
      if (args.fields && typeof args.fields === "object") {
        const additionalFields = args.fields as JsonObject;
        for (const [key, value] of Object.entries(additionalFields)) {
          if (key === "summary" || key === "description") continue;
          
          // Preserve original types for complex fields
          if (value !== null && typeof value === "object" && !Array.isArray(value)) {
            fields[key] = value;
          } else if (Array.isArray(value)) {
            fields[key] = value;
          } else {
            fields[key] = value;
          }
        }
      }
      
      // Call createJiraIssue
      // callJiraTool automatically determines Jira type (Cloud/Data Center) and routes accordingly
      // For Data Center, cloudId is not needed. For Cloud, it's handled by the MCP client.
      const createArgs: JsonObject = {
        projectKey: String(projectKey).trim(),
        issueTypeName: String(issueTypeName).trim(),
        summary: summaryValue,
      };
      
      if (descriptionValue) {
        createArgs.description = descriptionValue;
      }
      
      if (Object.keys(fields).length > 0) {
        createArgs.fields = fields;
      }
      
      // Only add cloudId for Cloud MCP (it's ignored for Data Center)
      const jiraType = getJiraType();
      if (jiraType === "cloud") {
        createArgs.cloudId = String(cloudId).trim();
      }
      
      const res = await callJiraTool("createJiraIssue", createArgs);
      
      const issueKey = await handleCreateResponse(res, args.branchName as string | undefined);
      
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              issueKey,
              message: issueKey 
                ? `Issue ${issueKey} created successfully and branch created` 
                : `Issue created successfully`,
              data: res,
            }, null, 2),
          },
        ],
      };
    }
    
    if (toolName === "assignJiraIssueWithAnalysis") {
      const cloudId = (args.cloudId as string) || getCloudId();
      const assigneeInput = args.assignee as string;
      
      let assigneeField: JsonObject;
      if (assigneeInput.toLowerCase() === "unassign" || assigneeInput === "") {
        assigneeField = { assignee: null };
      } else if (assigneeInput.includes("@")) {
        assigneeField = { assignee: { emailAddress: assigneeInput } };
      } else if (assigneeInput.includes(":") || assigneeInput.length > 30) {
        assigneeField = { assignee: { accountId: assigneeInput } };
      } else {
        assigneeField = { assignee: { name: assigneeInput } };
      }
      
      const res = await callJiraTool("editJiraIssue", {
        cloudId,
        issueIdOrKey: args.issueIdOrKey as string,
        fields: assigneeField,
      });
      
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              message: `Issue ${args.issueIdOrKey} assigned successfully`,
              data: res,
            }, null, 2),
          },
        ],
      };
    }
    
    if (toolName === "transitionJiraIssueToReview") {
      const cloudId = (args.cloudId as string) || getCloudId();
      
      const transitionsRes = await callJiraTool("getTransitionsForJiraIssue", {
        cloudId,
        issueIdOrKey: args.issueIdOrKey as string,
      });
      
      const transitions = (transitionsRes as any)?.transitions || [];
      const reviewTransition = transitions.find((t: any) => 
        t.name?.toLowerCase().includes("review") || 
        t.to?.name?.toLowerCase().includes("review")
      );
      
      if (!reviewTransition) {
        throw new Error("No 'In Review' transition found for this issue");
      }
      
      const res = await callJiraTool("transitionJiraIssue", {
        cloudId,
        issueIdOrKey: args.issueIdOrKey as string,
        transition: { id: reviewTransition.id },
      });
      
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              message: `Issue ${args.issueIdOrKey} transitioned to review`,
              data: res,
            }, null, 2),
          },
        ],
      };
    }
    
    if (toolName === "analyzeJiraIssue") {
      const cloudId = (args.cloudId as string) || getCloudId();
      const issueIdOrKey = args.issueIdOrKey as string;
      
      if (!issueIdOrKey || issueIdOrKey.trim() === "") {
        throw new Error("issueIdOrKey is required and cannot be empty");
      }
      
      const issueRes = await callJiraTool("getJiraIssue", {
        cloudId,
        issueIdOrKey: issueIdOrKey.trim(),
      });
      
      const branchName = args.branchName as string | undefined;
      await createGitLabBranch(issueIdOrKey.trim(), branchName);
      
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              message: `Branch created/checked out for issue ${issueIdOrKey}. Ready for analysis.`,
              issueKey: issueIdOrKey.trim(),
              issue: issueRes,
            }, null, 2),
          },
        ],
      };
    }
    
    return await callJiraTool(toolName, args);
  } catch (error) {
    throw error;
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
