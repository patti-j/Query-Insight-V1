import fs from "fs";

interface TestCase {
  id: string;
  question: string;
  expected?: number;
  sqlMustContain?: string[];
  sqlMustNotContain?: string[];
  description: string;
}

const cases: TestCase[] = JSON.parse(
  fs.readFileSync("tests/golden/jobs_report_cases.json", "utf8")
);

async function run() {
  let passed = 0;
  let failed = 0;

  for (const tc of cases) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`TEST: ${tc.id}`);
    console.log(`Q: ${tc.question}`);
    console.log(`Description: ${tc.description}`);

    const res = await fetch("http://localhost:5000/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: tc.question })
    });

    const data = await res.json();

    console.log("Generated SQL:", data.sql);
    console.log("Chatbot Answer:", data.answer);

    let testPassed = true;
    const failures: string[] = [];

    if (tc.expected !== undefined) {
      const answerContainsExpected = String(data.answer).includes(String(tc.expected));
      if (!answerContainsExpected) {
        testPassed = false;
        failures.push(`Expected answer to contain "${tc.expected}"`);
      }
    }

    if (tc.sqlMustContain) {
      for (const fragment of tc.sqlMustContain) {
        if (!data.sql?.toLowerCase().includes(fragment.toLowerCase())) {
          testPassed = false;
          failures.push(`SQL must contain: "${fragment}"`);
        }
      }
    }

    if (tc.sqlMustNotContain) {
      for (const fragment of tc.sqlMustNotContain) {
        if (data.sql?.toLowerCase().includes(fragment.toLowerCase())) {
          testPassed = false;
          failures.push(`SQL must NOT contain: "${fragment}"`);
        }
      }
    }

    if (testPassed) {
      console.log("✅ PASS");
      passed++;
    } else {
      console.log("❌ FAIL");
      failures.forEach(f => console.log(`   - ${f}`));
      failed++;
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`SUMMARY: ${passed} passed, ${failed} failed out of ${cases.length} tests`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
