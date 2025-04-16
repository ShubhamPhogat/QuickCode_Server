import { exec } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class JsTestRunner {
  constructor() {
    this.tempDir = path.join(__dirname, "temp_js");
    this.setupTempDir();
  }

  setupTempDir() {
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  async runScript(scriptFile, input, timeout) {
    return new Promise((resolve, reject) => {
      const child = exec(
        `node "${scriptFile}"`,
        { timeout },
        (error, stdout, stderr) => {
          if (error) {
            const err = new Error(stderr || "Runtime error");
            err.stderr = stderr;
            err.runtimeError = true;
            reject(err);
          } else {
            resolve(stdout);
          }
        }
      );

      child.stdin.write(input);
      child.stdin.end();
    });
  }

  async execute(job) {
    const jobId = job.job_id;
    const jsFile = path.join(this.tempDir, `${jobId}.js`);

    try {
      fs.writeFileSync(jsFile, job.code);

      const results = [];
      const generatedResults = [];
      for (const [index, testCase] of job.testCase.entries()) {
        try {
          const input = Array.isArray(testCase.input)
            ? testCase.input.join(" ") + "\n"
            : testCase.input + "\n";

          const output = await this.runScript(
            jsFile,
            input,
            job.timeout || 2000
          );

          results.push({
            testCaseId: index,
            input: input.trim(),
            expected: testCase.expected,
            actual: output.trim(),
            passed: output.trim() == testCase.expected,
          });
          generatedResults.push({
            input: testCase.input,
            expected: output.trim(),
          });
        } catch (err) {
          results.push({
            testCaseId: index,
            input: testCase.input,
            expected: testCase.expected,
            error: err.message,
            stderr: err.stderr || "",
            passed: false,
            runtimeError: true,
          });
        }
      }

      return {
        success: true,
        results,
        generatedResults,
        allPassed: results.every((r) => r.passed),
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        stderr: error.stderr || "",
        runtimeError: error.runtimeError || false,
      };
    } finally {
      this.cleanup([jsFile]);
    }
  }

  cleanup(files) {
    files.forEach((file) => {
      try {
        if (fs.existsSync(file)) fs.unlinkSync(file);
      } catch (e) {}
    });
  }
}
