import { exec, execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class CppTestRunner {
  constructor() {
    this.tempDir = path.join(__dirname, "temp_cpp");
    this.setupTempDir();
  }

  setupTempDir() {
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  async compile(sourceFile, outputFile) {
    const outputExe = outputFile + ".exe";
    try {
      const compileCmd = `g++ "${sourceFile}" -o "${outputExe}" -std=c++17`;
      execSync(compileCmd, {
        stdio: ["pipe", "pipe", "pipe"],
        shell: true,
      });

      if (!fs.existsSync(outputExe)) {
        throw new Error("Compiler did not produce output file");
      }
      return outputExe;
    } catch (e) {
      const errorOutput = e.stderr ? e.stderr.toString() : e.message;
      const compilationError = new Error("Compilation failed");
      compilationError.stderr = errorOutput;
      throw compilationError;
    }
  }

  async runExecutable(executable, input, timeout) {
    return new Promise((resolve, reject) => {
      const child = exec(
        `"${executable}"`,
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
    console.log("job recieved at cpp runner ", job);
    const jobId = job.job_id;
    const cppFile = path.join(this.tempDir, `${jobId}.cpp`);
    const executable = path.join(this.tempDir, jobId);

    try {
      fs.writeFileSync(cppFile, job.code);
      const executablePath = await this.compile(cppFile, executable);

      const results = [];
      const generatedResults = [];
      for (const [index, testCase] of job.testCase.entries()) {
        try {
          const input = Array.isArray(testCase.input)
            ? testCase.input.join(" ") + "\n"
            : testCase.input + "\n";

          const output = await this.runExecutable(
            executablePath,
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
        compilationError: !error.runtimeError,
        runtimeError: error.runtimeError || false,
      };
    } finally {
      this.cleanup([cppFile, executable + ".exe"]);
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
