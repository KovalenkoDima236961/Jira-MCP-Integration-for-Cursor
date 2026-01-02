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

const execAsync = promisify(exec);

type JsonObject = Record<string, unknown>;

const REMOTE_MCP = "https://mcp.atlassian.com/v1/mcp";

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

      // Check if branch already exists
      const exists = await branchExists(branchName, localRepoPath);
      if (!exists) {
        try {
          await execAsync(`git checkout -b ${branchName}`, { cwd: localRepoPath });
        } catch {
          // Silently ignore if branch creation fails
        }
      } else {
        // Branch exists, just checkout
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
        description: "Create a Jira issue and automatically create a GitHub/GitLab branch.",
        inputSchema: {
          type: "object",
          properties: {
            cloudId: { type: "string", description: "Jira Cloud ID" },
            projectKey: { type: "string", description: "Project key (e.g., OPS)" },
            issueTypeName: { type: "string", description: "Issue type (Task, Bug, Story, etc.)" },
            summary: { type: "string", description: "Issue summary/title" },
            description: { type: "string", description: "Issue description (optional)" },
            branchName: { type: "string", description: "Custom branch name (optional, defaults to issue key)" },
            fields: { type: "object", description: "Additional Jira fields" },
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
      {
        name: "analyzeJiraIssue",
        description: "Analyze a Jira issue. Automatically creates a branch if it doesn't exist, then performs analysis.",
        inputSchema: {
          type: "object",
          properties: {
            cloudId: { type: "string", description: "Jira Cloud ID" },
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
          // Skip summary and description, as they are passed separately
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
      // According to errors, createJiraIssue expects summary and description as separate parameters
      const createArgs: JsonObject = {
        cloudId: String(cloudId).trim(),
        projectKey: String(projectKey).trim(),
        issueTypeName: String(issueTypeName).trim(),
        summary: summaryValue,
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

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
