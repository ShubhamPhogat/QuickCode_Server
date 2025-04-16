const { createClient } = require("redis");
const { exec, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const uuid = require("uuid");
const { json } = require("stream/consumers");
const { CppTestRunner } = require("./cpp_runner");
const { PythonTestRunner } = require("./python_runner");

const main = async () => {
  const cppRunner = new CppTestRunner();
  const pyRunner = new PythonTestRunner();
  try {
    const redisClient = createClient({ url: "redis://127.0.0.1:6377" });
    await redisClient.connect();
    console.log("Connected to Redis");

    while (true) {
      const message = await redisClient.brPop("message", 0);
      if (!message) continue;

      const { element } = message;
      const job = JSON.parse(element);
      console.log(job);
      const language = job.language;

      switch (language) {
        case "C++":
          const cppResult = await cppRunner.execute(job);
          console.log("sendng back", job.job_id);
          await redisClient.publish(`${job.job_id}`, JSON.stringify(cppResult));
          console.log(`Completed job ${job.job_id}`);
          break;
        case "Python":
          const pyResult = await pyRunner.execute(job);

          await redisClient.lPush(
            `results:${job.job_id}`,
            JSON.stringify(pyResult)
          );
          console.log(`Completed job ${job.job_id}`);

        default:
          break;
      }
    }
  } catch (error) {
    console.error("Worker error:", error);
    process.exit(1);
  }
};

main();
