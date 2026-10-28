module.exports = {
  apps: [
    {
      name: "canyon-web",
      cwd: __dirname,
      script: ".next/standalone/server.js",
      interpreter: "bun", // or "node"
      env: {
        NODE_ENV: "production",
        PORT: 3000,
        HOSTNAME: "0.0.0.0",
      },
      instances: 1,
      autorestart: true,
      max_memory_restart: "1G",
    },
    {
      name: "canyon-multiplayer",
      cwd: `${__dirname}/mini-services/racing-service`,
      script: "index.ts",
      interpreter: "bun",
      env: {
        NODE_ENV: "production",
        PORT: 3003,
      },
      instances: 1,
      autorestart: true,
      max_memory_restart: "512M",
    },
  ],
};
