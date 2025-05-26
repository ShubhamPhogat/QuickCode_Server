const { WebSocketServer } = require("ws");
const { RedisManager } = require("./RedisManager");
const { fail } = require("assert");

const main = async function () {
  try {
    const wss = new WebSocketServer({ port: 8080 });
    console.log("WebSocket server is running on port 8080");
    wss.on("connection", (ws) => {
      ws.on("message", async (msg) => {
        const data = JSON.parse(msg);
        console.log(data);

        const job = {
          code: data.editorCode,
          language: data.selectedLanguage,
          testCase: data.testCase,
          timeout: 2000,
        };
        const rm = await RedisManager.getInstance();
        const res = await rm.sendToWorker(job);
        console.log("this is ", res);

        if (data.exampleTestCases) {
          ws.send(JSON.stringify(res));
        } else if (data.all) {
          ws.send(
            JSON.stringify({
              data: res.generatedResults,
            })
          );
        } else if (res.success) {
          if (res.allPassed) {
            ws.send(JSON.stringify({ status: 1, allPassed: true }));
          } else {
            let failedTestCase = null;
            for (tc of res.results) {
              if (!tc.passed) {
                failedTestCase = tc;
                break;
              }
            }
            ws.send(
              JSON.stringify({ status: 1, allPassed: false, failedTestCase })
            );
          }
        } else {
          ws.send(
            JSON.stringify({
              status: 0,
              msg: `compilation error ${res.stderr} `,
            })
          );
        }
      });
    });
  } catch (error) {
    console.error(error);
  }
};
main();
