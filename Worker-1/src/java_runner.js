import { exec, execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class JavaTestRunner {
  constructor() {
    this.tempDir = path.join(__dirname, "temp_java");
    this.setupTempDir();
  }

  setupTempDir() {
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  extractClassName(code) {
    // Extract the public class name from the Java code
    const classMatch = code.match(/public\s+class\s+(\w+)/);
    if (classMatch) {
      return classMatch[1];
    }
    // If no public class, look for any class with main method
    const mainMatch = code.match(
      /class\s+(\w+)[\s\S]*?public\s+static\s+void\s+main/
    );
    if (mainMatch) {
      return mainMatch[1];
    }
    // Default class name
    return "Main";
  }

  async compile(sourceFile, className) {
    try {
      const compileCmd = `javac "${sourceFile}"`;
      execSync(compileCmd, {
        stdio: ["pipe", "pipe", "pipe"],
        shell: true,
        cwd: this.tempDir,
      });

      const classFile = path.join(this.tempDir, `${className}.class`);
      if (!fs.existsSync(classFile)) {
        throw new Error("Compiler did not produce output file");
      }
      return className;
    } catch (e) {
      const errorOutput = e.stderr ? e.stderr.toString() : e.message;
      const compilationError = new Error("Compilation failed");
      compilationError.stderr = errorOutput;
      throw compilationError;
    }
  }

  async runJavaClass(className, input, timeout) {
    return new Promise((resolve, reject) => {
      const child = exec(
        `java ${className}`,
        {
          timeout,
          cwd: this.tempDir,
        },
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

  prepareJavaCode(code, className) {
    // If the code doesn't have a public class declaration, wrap it
    if (
      !code.includes("public class") &&
      !code.includes("class " + className)
    ) {
      // Check if it's just the main method content
      if (!code.includes("public static void main")) {
        // Wrap the code in a complete Java class
        return `
import java.util.*;
import java.io.*;

public class ${className} {
    public static void main(String[] args) {
        Scanner scanner = new Scanner(System.in);
        ${code}
        scanner.close();
    }
}`;
      } else {
        // Code has main method but no class declaration
        return `
import java.util.*;
import java.io.*;

public class ${className} {
    ${code}
}`;
      }
    }

    // Ensure the class name matches
    return code.replace(/public\s+class\s+\w+/, `public class ${className}`);
  }

  async execute(job) {
    console.log("job recieved at java runner ", job);
    const jobId = job.job_id;
    const className = "Solution_" + jobId.replace(/-/g, "_");
    const javaFile = path.join(this.tempDir, `${className}.java`);

    try {
      // Prepare the Java code
      const preparedCode = this.prepareJavaCode(job.code, className);
      fs.writeFileSync(javaFile, preparedCode);

      // Compile the Java code
      await this.compile(javaFile, className);

      const results = [];
      const generatedResults = [];

      for (const [index, testCase] of job.testCase.entries()) {
        try {
          // Format input - flatten arrays and join with spaces, add newline
          const input = Array.isArray(testCase.input)
            ? testCase.input.flat().join(" ") + "\n"
            : testCase.input + "\n";

          const output = await this.runJavaClass(
            className,
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
      // Clean up all generated files
      this.cleanup([
        javaFile,
        ...fs
          .readdirSync(this.tempDir)
          .filter(
            (file) => file.startsWith(className) && file.endsWith(".class")
          )
          .map((file) => path.join(this.tempDir, file)),
      ]);
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
