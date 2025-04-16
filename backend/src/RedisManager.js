import { createClient } from "redis";
import { v4 } from "uuid";

export class RedisManager {
  static instance = null;

  constructor() {
    if (RedisManager.instance) {
      return RedisManager.instance;
    }
    RedisManager.instance = this;
  }

  async init() {
    this.publisher = createClient({ url: "redis://127.0.0.1:6377" });
    this.subscriber = createClient({ url: "redis://127.0.0.1:6377" });
    await this.publisher.connect();
    await this.subscriber.connect();
  }

  static async getInstance() {
    if (RedisManager.instance) {
      return RedisManager.instance;
    }
    const instance = new RedisManager();
    await instance.init();
    return instance;
  }

  async sendToWorker(job) {
    try {
      if (!job) {
        console.error("no job to send to worker");
        return;
      }
      const job_id = v4();
      if (this.publisher.isOpen) {
        try {
          const executableJob = { ...job, job_id };
          await this.publisher.lPush("message", JSON.stringify(executableJob));
          console.log(`Job ${job_id} sent to worker.`);
          return new Promise((resolve, reject) => {
            const cleanup = () => {
              this.subscriber.unsubscribe(job_id);
              this.subscriber.removeAllListeners("message");
              this.subscriber.removeAllListeners("error");
            };

            this.subscriber.subscribe(`${job_id}`, (response) => {
              try {
                console.log("Response received:", response);
                resolve(JSON.parse(response));
              } catch (error) {
                console.error("Error parsing response:", error);
                reject(error);
              } finally {
                cleanup();
              }
            });
          });
        } catch (error) {
          console.error("Error in sending request to worker", error);
        }
      }
    } catch (error) {
      console.error("Error in sending request to worker", error);
    }
  }
}
