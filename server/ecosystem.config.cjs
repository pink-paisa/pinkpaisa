module.exports = {
  apps: [
    {
      name: "pinkpaisa-server",
      script: "./server.js",
      cwd: "/home/ubuntu/pinkpaisa/server",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "pinkpaisa-marketing-worker",
      script: "./workers/marketingWorker.js",
      cwd: "/home/ubuntu/pinkpaisa/server",
      env: {
        NODE_ENV: "production",
        MARKETING_WORKER_IN_API: "false",
        MARKETING_SCHEDULER_IN_API: "false",
      },
    },
    {
      name: "pinkpaisa-frontend",
      script: "./node_modules/next/dist/bin/next",
      args: "start -p 3000",
      cwd: "/home/ubuntu/pinkpaisa/frontend-next",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
    },
  ],
};
