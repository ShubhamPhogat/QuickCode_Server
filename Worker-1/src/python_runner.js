import { PythonShell } from "python-shell";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class PythonTestRunner {
  constructor() {
    this.tempDir = path.join(__dirname, "temp_python");
    this.setupTempDir();
  }

  setupTempDir() {
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  async runPythonScript(scriptPath, args, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const options = {
        mode: "text",
        pythonPath: "python", // Changed from python3 to python since you have Python 2/regular Python
        pythonOptions: ["-u"],
        scriptPath: path.dirname(scriptPath),
        args: args,
      };

      let output = "";
      let errorOutput = "";

      const pyshell = new PythonShell(path.basename(scriptPath), options);

      const timeoutId = setTimeout(() => {
        pyshell.kill();
        reject(new Error(`Execution timeout after ${timeout}ms`));
      }, timeout);

      pyshell.on("message", (message) => {
        output += message + "\n";
      });

      pyshell.on("stderr", (stderr) => {
        errorOutput += stderr + "\n";
      });

      pyshell.end((err, code, signal) => {
        clearTimeout(timeoutId);

        if (err) {
          const error = new Error(
            errorOutput || err.message || "Python execution failed"
          );
          error.stderr = errorOutput;
          error.runtimeError = true;
          reject(error);
        } else {
          resolve(output.trim());
        }
      });
    });
  }

  parseInput(testCase) {
    console.log(
      "Raw testCase.input:",
      testCase.input,
      "Type:",
      typeof testCase.input
    );

    if (Array.isArray(testCase.input)) {
      // Handle array input - need to parse each element
      let allArgs = [];

      for (const item of testCase.input) {
        const itemStr = item.toString().trim();
        // Split each item by whitespace to get individual arguments
        const splitArgs = itemStr.split(/\s+/).filter((arg) => arg.length > 0);
        allArgs.push(...splitArgs);
      }

      console.log("Array input converted to args:", allArgs);
      return allArgs;
    } else {
      // Handle string input - split into individual arguments
      const inputStr = testCase.input.toString().trim();
      console.log("String input:", `"${inputStr}"`);

      // Split by whitespace and filter out empty strings
      const args = inputStr.split(/\s+/).filter((arg) => arg.length > 0);

      console.log(`Parsed string "${inputStr}" -> args:`, args);
      return args;
    }
  }

  async execute(job) {
    console.log("Job received at Python runner:", job);
    const jobId = job.job_id;
    const pythonFile = path.join(this.tempDir, `${jobId}.py`);

    try {
      // Write the Python code to a temporary file
      fs.writeFileSync(pythonFile, job.code);

      const results = [];
      const generatedResults = [];

      // Run each test case
      for (const [index, testCase] of job.testCase.entries()) {
        try {
          // Parse input arguments for sys.argv
          const inputArgs = this.parseInput(testCase);

          console.log(`Running test case ${index + 1}:`, {
            input: testCase.input,
            parsedArgs: inputArgs,
            expected: testCase.expected,
          });

          // Run the Python script with arguments
          const output = await this.runPythonScript(
            pythonFile,
            inputArgs,
            job.timeout || 5000
          );

          const actualOutput = output.trim();
          const expectedOutput = testCase.expected.toString().trim();
          const passed = actualOutput === expectedOutput;

          results.push({
            testCaseId: index,
            input: testCase.input,
            expected: expectedOutput,
            actual: actualOutput,
            passed: passed,
          });

          generatedResults.push({
            input: testCase.input,
            expected: actualOutput,
          });

          console.log(`Test case ${index + 1} result:`, {
            expected: expectedOutput,
            actual: actualOutput,
            passed: passed,
          });
        } catch (err) {
          console.error(`Test case ${index + 1} error:`, err.message);

          results.push({
            testCaseId: index,
            input: testCase.input,
            expected: testCase.expected,
            error: err.message,
            stderr: err.stderr || "",
            passed: false,
            runtimeError: true,
          });

          generatedResults.push({
            input: testCase.input,
            expected: "ERROR",
          });
        }
      }

      const allPassed = results.every((r) => r.passed);

      return {
        success: true,
        results,
        generatedResults,
        allPassed,
        failedTestCase: allPassed ? null : results.find((r) => !r.passed),
      };
    } catch (error) {
      console.error("Python runner execution error:", error);

      return {
        success: false,
        error: error.message,
        stderr: error.stderr || "",
        compilationError: false,
        runtimeError: true,
      };
    } finally {
      // Clean up temporary files
      this.cleanup([pythonFile]);
    }
  }

  cleanup(files) {
    files.forEach((file) => {
      try {
        if (fs.existsSync(file)) {
          fs.unlinkSync(file);
          console.log(`Cleaned up temporary file: ${file}`);
        }
      } catch (e) {
        console.error(`Failed to cleanup file ${file}:`, e.message);
      }
    });
  }
}

// Child process version with the same fix
export class PythonTestRunnerChildProcess {
  constructor() {
    this.tempDir = path.join(__dirname, "temp_python");
    this.setupTempDir();
  }

  setupTempDir() {
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  async runPythonScript(scriptPath, args, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const { spawn } = require("child_process");

      // Create command with arguments
      const pythonArgs = [scriptPath, ...args];
      const child = spawn("python", pythonArgs, {
        // Changed from python3 to python
        stdio: ["pipe", "pipe", "pipe"],
        timeout: timeout,
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      child.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      child.on("close", (code) => {
        if (code !== 0) {
          const error = new Error(stderr || `Process exited with code ${code}`);
          error.stderr = stderr;
          error.runtimeError = true;
          reject(error);
        } else {
          resolve(stdout.trim());
        }
      });

      child.on("error", (err) => {
        const error = new Error(
          `Failed to start Python process: ${err.message}`
        );
        error.stderr = err.message;
        error.runtimeError = true;
        reject(error);
      });

      // Handle timeout
      setTimeout(() => {
        if (!child.killed) {
          child.kill("SIGTERM");
          reject(new Error(`Execution timeout after ${timeout}ms`));
        }
      }, timeout);
    });
  }

  parseInput(testCase) {
    if (Array.isArray(testCase.input)) {
      // Handle array input - need to parse each element
      let allArgs = [];

      for (const item of testCase.input) {
        const itemStr = item.toString().trim();
        // Split each item by whitespace to get individual arguments
        const splitArgs = itemStr.split(/\s+/).filter((arg) => arg.length > 0);
        allArgs.push(...splitArgs);
      }

      return allArgs;
    } else {
      // Handle string input - split into individual arguments
      const inputStr = testCase.input.toString().trim();
      return inputStr.split(/\s+/).filter((arg) => arg.length > 0);
    }
  }

  async execute(job) {
    console.log("Job received at Python runner (child_process):", job);
    const jobId = job.job_id;
    const pythonFile = path.join(this.tempDir, `${jobId}.py`);

    try {
      fs.writeFileSync(pythonFile, job.code);

      const results = [];
      const generatedResults = [];

      for (const [index, testCase] of job.testCase.entries()) {
        try {
          const inputArgs = this.parseInput(testCase);

          console.log(`Running test case ${index + 1} with args:`, inputArgs);

          const output = await this.runPythonScript(
            pythonFile,
            inputArgs,
            job.timeout || 5000
          );

          const actualOutput = output.trim();
          const expectedOutput = testCase.expected.toString().trim();
          const passed = actualOutput === expectedOutput;

          results.push({
            testCaseId: index,
            input: testCase.input,
            expected: expectedOutput,
            actual: actualOutput,
            passed: passed,
          });

          generatedResults.push({
            input: testCase.input,
            expected: actualOutput,
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
        failedTestCase: results.find((r) => !r.passed) || null,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        stderr: error.stderr || "",
        compilationError: false,
        runtimeError: true,
      };
    } finally {
      this.cleanup([pythonFile]);
    }
  }

  cleanup(files) {
    files.forEach((file) => {
      try {
        if (fs.existsSync(file)) {
          fs.unlinkSync(file);
        }
      } catch (e) {
        console.error(`Cleanup error: ${e.message}`);
      }
    });
  }
}
