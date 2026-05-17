import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import axios from "axios";
import { Octokit } from "octokit";
import dotenv from "dotenv";

// Removed dotenv.config() to avoid overriding system environment variables
// dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// GitHub OAuth Endpoints
app.get("/api/auth/github/url", (req, res) => {
  const redirectUri = `${process.env.APP_URL}/auth/github/callback`;
  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID!,
    redirect_uri: redirectUri,
    scope: "repo,user",
  });
  res.json({ url: `https://github.com/login/oauth/authorize?${params}` });
});

app.get("/auth/github/callback", async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send("No code provided");

  try {
    const response = await axios.post(
      "https://github.com/login/oauth/access_token",
      {
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
      },
      { headers: { Accept: "application/json" } }
    );

    const { access_token } = response.data;

    // Send success message and close popup
    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'GITHUB_AUTH_SUCCESS', token: '${access_token}' }, '*');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
          <p>Authentication successful. This window should close automatically.</p>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("GitHub OAuth error:", error);
    res.status(500).send("Authentication failed");
  }
});

// GitHub Push Endpoint
app.post("/api/push-contribution", async (req, res) => {
  const { token, repoName, content } = req.body;
  console.log(`Starting GitHub push for repo: ${repoName}`);
  
  if (!token || !repoName || !content) {
    return res.status(400).json({ error: "Token, repoName, and content required" });
  }

  try {
    const octokit = new Octokit({ auth: token });
    const [owner, repo] = repoName.split("/");
    if (!owner || !repo) throw new Error("Invalid repoName format. Use 'owner/repo'");

    // Get the file if it exists to get the SHA
    let sha;
    const filePath = "DAILY_INSIGHTS.md";
    
    const pushToFile = async () => {
      try {
        const { data } = await octokit.rest.repos.getContent({
          owner,
          repo,
          path: filePath,
          headers: {
            'If-None-Match': '', // Attempt to bypass cache
          }
        });
        if (!Array.isArray(data)) {
          sha = data.sha;
          console.log(`Existing file found, SHA: ${sha}`);
        }
      } catch (e: any) {
        if (e.status === 404) {
          console.log("File does not exist, creating new one...");
        } else {
          console.error("Error fetching file content:", e.message);
        }
      }

      const commitMessage = `Daily Tech Insight: ${new Date().toLocaleDateString()}`;
      const newContent = Buffer.from(`# Daily GitPulse Insights\n\nLast Updated: ${new Date().toISOString()}\n\n${content}`).toString("base64");

      await octokit.rest.repos.createOrUpdateFileContents({
        owner,
        repo,
        path: filePath,
        message: commitMessage,
        content: newContent,
        sha,
      });
    };

    try {
      await pushToFile();
    } catch (error: any) {
      // If it's a conflict (SHA mismatch), retry once
      if (error.status === 409) {
        console.log("SHA mismatch detected (409), retrying once with fresh SHA...");
        sha = undefined; // Reset SHA just in case
        await pushToFile();
      } else {
        throw error;
      }
    }

    console.log("GitHub push successful");
    res.json({ success: true, commitMessage: `Daily Tech Insight: ${new Date().toLocaleDateString()}` });
  } catch (error: any) {
    console.error("GitHub push error details:", error);
    res.status(500).json({ error: error.message || "Internal server error" });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
