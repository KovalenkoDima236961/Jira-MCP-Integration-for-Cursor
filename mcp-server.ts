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

type JsonObject = Record<string, unknown>;

// Connection to remote Atlassian MCP server
const REMOTE_MCP = "https://mcp.atlassian.com/v1/mcp";

// Create client for connecting to Atlassian MCP
let jiraClient: Client | null = null;
let jiraTransport: StdioClientTransport | null = null;

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
  const client = await getJiraClient();
  const result = await client.request(
    { method: "tools/call", params: { name, arguments: args } },
    CallToolResultSchema
  );
  return result;
}

// Transliteration of Ukrainian and other characters to English
function transliterateToEnglish(text: string): string {
  const transliterationMap: Record<string, string> = {
    // Ukrainian characters
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'h', 'ґ': 'g', 'д': 'd', 'е': 'e', 'є': 'ie',
    'ж': 'zh', 'з': 'z', 'и': 'y', 'і': 'i', 'ї': 'i', 'й': 'i', 'к': 'k', 'л': 'l',
    'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u',
    'ф': 'f', 'х': 'kh', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'shch', 'ь': '',
    'ю': 'iu', 'я': 'ia',
    // Uppercase letters
    'А': 'A', 'Б': 'B', 'В': 'V', 'Г': 'H', 'Ґ': 'G', 'Д': 'D', 'Е': 'E', 'Є': 'IE',
    'Ж': 'ZH', 'З': 'Z', 'И': 'Y', 'І': 'I', 'Ї': 'I', 'Й': 'I', 'К': 'K', 'Л': 'L',
    'М': 'M', 'Н': 'N', 'О': 'O', 'П': 'P', 'Р': 'R', 'С': 'S', 'Т': 'T', 'У': 'U',
    'Ф': 'F', 'Х': 'KH', 'Ц': 'TS', 'Ч': 'CH', 'Ш': 'SH', 'Щ': 'SHCH', 'Ь': '',
    'Ю': 'IU', 'Я': 'IA',
    // Russian characters
    'ы': 'y', 'э': 'e', 'ъ': '', 'ё': 'e',
    'Ы': 'Y', 'Э': 'E', 'Ъ': '', 'Ё': 'E',
  };
  
  return text
    .split('')
    .map(char => transliterationMap[char] || char)
    .join('');
}

function sanitizeBranchName(name: string): string {
  // First transliterate to English
  const transliterated = transliterateToEnglish(name);
  
  // Then clean and format
  return transliterated
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
  
  // If it's a URL, extract the path
  if (repoPath.startsWith("http://") || repoPath.startsWith("https://")) {
    try {
      const url = new URL(repoPath);
      repoPath = url.pathname;
      // Remove leading slash and .git if present
      repoPath = repoPath.replace(/^\/|\/$|\.git$/g, "");
    } catch {
      return null;
    }
  }
  
  // Remove .git if present
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

function parseGitLabRepo(repo: string): string {
  // GitLab accepts "owner/repo", project ID, or full path
  // If it's a URL, extract the path
  if (repo.startsWith("http://") || repo.startsWith("https://")) {
    try {
      const url = new URL(repo);
      const path = url.pathname.replace(/^\/|\/$|\.git$/g, "");
      return path;
    } catch {
      return repo;
    }
  }
  return repo.replace(/\.git$/, "");
}

async function createGitLabBranch(issueKey: string, customBranchName?: string): Promise<void> {
  const gitlabToken = process.env.GITLAB_TOKEN;
  const gitlabRepo = process.env.GITLAB_REPO;
  const gitlabUrl = process.env.GITLAB_URL || "https://gitlab.com";

  if (!gitlabToken || !gitlabRepo) {
    return;
  }

  try {
    // Parse repo (supports URL and owner/repo or project-id format)
    const repoPath = parseGitLabRepo(gitlabRepo);
    
    let branchName: string;
    if (customBranchName && customBranchName.trim()) {
      branchName = sanitizeBranchName(customBranchName.trim());
    } else {
      branchName = issueKey.toLowerCase();
    }
    
    const defaultBranch = process.env.GITLAB_DEFAULT_BRANCH || "main";
    const baseUrl = gitlabUrl.replace(/\/$/, "");
    const encodedRepo = encodeURIComponent(repoPath);

    const options: https.RequestOptions = {
      hostname: baseUrl.replace(/^https?:\/\//, "").split("/")[0],
      path: `/api/v4/projects/${encodedRepo}/repository/branches`,
      method: "POST",
      headers: {
        "PRIVATE-TOKEN": gitlabToken,
        "Content-Type": "application/json",
      },
    };

    const data = JSON.stringify({
      branch: branchName,
      ref: defaultBranch,
    });

    await httpsRequest(options, data);
  } catch (error: unknown) {
    // Silently handle errors - don't log to Jira
  }
}

async function handleCreateResponse(res: unknown, branchNameInput?: string): Promise<string | null> {
  let issueKey: string | null = null;
  try {
    // Handle different response formats
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
    
    // Check if it's an error
    if (responseObj?.isError || responseObj?.error) {
      return null;
    }
    
    // Try different paths to get issueKey
    if (responseObj?.content && Array.isArray(responseObj.content)) {
      // If response is in MCP content format
      for (const item of responseObj.content) {
        if (item.type === "text" && item.text) {
          try {
            const parsed = JSON.parse(item.text);
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
      // Direct field access
      issueKey = responseObj?.key || 
                 responseObj?.fields?.key || 
                 responseObj?.id ||
                 responseObj?.issueKey ||
                 null;
    }
    
    // If we found issueKey, create branch
    if (issueKey) {
      const branchName = branchNameInput || undefined;
      const hasGitHub = !!(process.env.GITHUB_TOKEN && process.env.GITHUB_REPO);
      const hasGitLab = !!(process.env.GITLAB_TOKEN && process.env.GITLAB_REPO);
      
      if (hasGitHub && hasGitLab) {
        await createGitHubBranch(issueKey, branchName);
      } else if (hasGitHub) {
        await createGitHubBranch(issueKey, branchName);
      } else if (hasGitLab) {
        await createGitLabBranch(issueKey, branchName);
      }
    }
  } catch (error) {
    // Silently handle errors
  }
  
  return issueKey;
}

function getCloudId(): string {
  const envCloudId = process.env.JIRA_CLOUD_ID || process.env.CLOUD_ID;
  if (envCloudId) {
    return envCloudId.replace(/^["']|["']$/g, '').trim();
  }
  throw new Error("JIRA_CLOUD_ID not set. Please set it in environment variables.");
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
    const client = await getJiraClient();
    const jiraTools = await client.request({ method: "tools/list" }, ListToolsResultSchema);
    
    // Add custom tools with additional logic
    const customTools: Tool[] = [
      {
        name: "createJiraIssueWithBranch",
        description: "Create a Jira issue and automatically create a GitHub/GitLab branch. Supports both dev (simple) and prod (full form) modes.",
        inputSchema: {
          type: "object",
          properties: {
            cloudId: { type: "string", description: "Jira Cloud ID" },
            projectKey: { type: "string", description: "Project key (e.g., OPS)" },
            issueTypeName: { type: "string", description: "Issue type (Task, Bug, Story, etc.)" },
            summary: { type: "string", description: "Issue summary/title" },
            description: { type: "string", description: "Issue description (optional)" },
            branchName: { type: "string", description: "Custom branch name (optional, defaults to issue key)" },
            mode: { type: "string", enum: ["dev", "prod"], description: "Creation mode: 'dev' for simple, 'prod' for full form" },
            fields: { type: "object", description: "Additional Jira fields (for prod mode)" },
          },
          required: ["cloudId", "projectKey", "issueTypeName", "summary"],
        },
      },
      {
        name: "assignJiraIssueWithAnalysis",
        description: "Assign a Jira issue to a user and trigger Cursor code analysis if enabled.",
        inputSchema: {
          type: "object",
          properties: {
            cloudId: { type: "string", description: "Jira Cloud ID" },
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
            cloudId: { type: "string", description: "Jira Cloud ID" },
            issueIdOrKey: { type: "string", description: "Issue key (e.g., OPS-123)" },
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

// Handle call tool
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const toolName = request.params.name;
  const args = request.params.arguments || {};
  
  try {
    // Handle custom tools
    if (toolName === "createJiraIssueWithBranch") {
      // Validate required parameters
      const cloudId = (args.cloudId as string) || getCloudId();
      const projectKey = args.projectKey as string;
      const issueTypeName = args.issueTypeName as string;
      const summary = args.summary as string;
      
      // Validate required parameters
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
      
      // Add additional fields for prod mode (without summary and description)
      if (args.mode === "prod" && args.fields && typeof args.fields === "object") {
        const additionalFields = args.fields as JsonObject;
        for (const [key, value] of Object.entries(additionalFields)) {
          // Skip summary and description, as they are passed separately
          if (key === "summary" || key === "description") continue;
          
          // Preserve original types for complex fields
          if (value !== null && typeof value === "object" && !Array.isArray(value)) {
            fields[key] = value; // assignee, reporter, etc.
          } else if (Array.isArray(value)) {
            fields[key] = value; // arrays
          } else {
            fields[key] = value; // other fields
          }
        }
      }
      
      // Call createJiraIssue
      // According to errors, createJiraIssue expects summary and description as separate parameters
      const createArgs: JsonObject = {
        cloudId: String(cloudId).trim(),
        projectKey: String(projectKey).trim(),
        issueTypeName: String(issueTypeName).trim(),
        summary: summaryValue, // summary as separate parameter
      };
      
      // Add description as separate parameter if present
      if (descriptionValue) {
        createArgs.description = descriptionValue;
      }
      
      // Add fields only if there's something besides summary and description
      if (Object.keys(fields).length > 0) {
        createArgs.fields = fields;
      }
      
      const res = await callJiraTool("createJiraIssue", createArgs);
      
      // Handle response and create branch
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
      
      // First get available transitions
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
    
    // Proxy all other calls to Atlassian MCP
    const client = await getJiraClient();
    const result = await client.request(
      { method: "tools/call", params: { name: toolName, arguments: args } },
      CallToolResultSchema
    );
    return result;
  } catch (error) {
    throw error;
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
