import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import Database from "better-sqlite3";

import { createApp } from "../server/app.js";
import { MAX_FILE_BYTES } from "../server/config.js";
import { createDatabase } from "../server/database.js";
import {
  UploadValidationError,
  normalizeUploadOriginalName,
  validateUploadFile,
} from "../server/file-storage.js";
import {
  IdentityCardRecognitionError,
  createIdentityCardRecognizer,
  isValidIdentityCardNumber,
  parseIdentityCardNumber,
} from "../server/identity-card-recognizer.js";
import { createEmployeeSubmission } from "../server/submissions.js";

const projectRoot = path.resolve(import.meta.dirname, "..");
const VALID_ID_CARD_NUMBER = "11010519491231002X";

function createTempDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "employee-information-test-"));
}

function createHarness({
  adminCredentials = { username: "admin", password: "secret-pass" },
  identityCardRecognizer = async () => VALID_ID_CARD_NUMBER,
} = {}) {
  const tempDir = createTempDirectory();
  const db = createDatabase({
    dbFilePath: path.join(tempDir, "data", "app.db"),
    dbInitSqlPath: path.join(projectRoot, "db", "init.sql"),
  });
  const uploadsRoot = path.join(tempDir, "uploads");
  const app = createApp({
    db,
    uploadDirectory: uploadsRoot,
    staticDir: path.join(projectRoot, "public"),
    adminCredentials,
    identityCardRecognizer,
  });
  return {
    app,
    db,
    tempDir,
    uploadsRoot,
    close() {
      db.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

async function withServer(app, fn) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
}

function jpegBytes(size = 12) {
  const bytes = Buffer.alloc(size, 0);
  bytes.set([0xff, 0xd8, 0xff, 0xe0], 0);
  return bytes;
}

function pngBytes() {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
}

function pdfBytes() {
  return Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF", "ascii");
}

function heifBytes(brand = "heic") {
  const bytes = Buffer.alloc(24, 0);
  bytes.writeUInt32BE(24, 0);
  bytes.write("ftyp", 4, "ascii");
  bytes.write(brand, 8, "ascii");
  bytes.write("mif1", 16, "ascii");
  return bytes;
}

function makeFile(bytes, name, type) {
  return new File([bytes], name, { type });
}

function validFormData({
  name = "张三",
  phone = "13800000000",
  position = "front_of_house",
  front = makeFile(jpegBytes(), "front.jpg", "image/jpeg"),
  back = makeFile(pngBytes(), "back.png", "image/png"),
  health = null,
} = {}) {
  const data = new FormData();
  data.set("name", name);
  data.set("phone", phone);
  data.set("position", position);
  data.set("idCardFront", front);
  data.set("idCardBack", back);
  if (health) data.set("healthCertificate", health);
  return data;
}

function authHeaders(username = "admin", password = "secret-pass") {
  return { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` };
}

async function submit(baseUrl, options = {}, storeKey = "fuzzy") {
  return fetch(`${baseUrl}/employee/api/submissions/${storeKey}`, {
    method: "POST",
    body: validFormData(options),
  });
}

function listStoredFiles(root) {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
}

test("database migration adds position columns without fabricating legacy values", () => {
  const tempDir = createTempDirectory();
  const dbFilePath = path.join(tempDir, "data", "app.db");
  fs.mkdirSync(path.dirname(dbFilePath), { recursive: true });
  const initSqlPath = path.join(projectRoot, "db", "init.sql");
  const legacySchema = fs
    .readFileSync(initSqlPath, "utf8")
    .replaceAll(
      "  position TEXT CHECK (position IN ('front_of_house', 'back_of_house')),\n",
      ""
    );
  const legacyDb = new Database(dbFilePath);
  legacyDb.exec(legacySchema);
  legacyDb
    .prepare(
      `INSERT INTO employee_submissions (
        id, name, phone, store_key, current_version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 0, ?, ?)`
    )
    .run("legacy-id", "旧员工", "13800000000", "fuzzy", "2026-01-01", "2026-01-01");
  legacyDb.close();

  const migratedDb = createDatabase({ dbFilePath, dbInitSqlPath: initSqlPath });
  try {
    assert.ok(
      migratedDb.prepare("PRAGMA table_info(employee_submissions)").all().some((column) => column.name === "position")
    );
    assert.ok(
      migratedDb.prepare("PRAGMA table_info(employee_submission_revisions)").all().some((column) => column.name === "position")
    );
    assert.ok(
      migratedDb.prepare("PRAGMA table_info(employee_submissions)").all().some((column) => column.name === "identity_card_number")
    );
    assert.ok(
      migratedDb.prepare("PRAGMA table_info(employee_submission_revisions)").all().some((column) => column.name === "identity_card_number")
    );
    assert.equal(
      migratedDb.prepare("SELECT position FROM employee_submissions WHERE id = ?").get("legacy-id").position,
      null
    );
  } finally {
    migratedDb.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("only the three store routes expose the form and portal requires auth", async () => {
  const harness = createHarness();
  try {
    await withServer(harness.app, async (baseUrl) => {
      for (const route of ["/employee/fuzzy", "/employee/fuzzy_qz", "/employee/peanut"]) {
        const response = await fetch(`${baseUrl}${route}`);
        assert.equal(response.status, 200);
        const html = await response.text();
        assert.match(html, /新员工入职信息/);
        assert.doesNotMatch(html, /name="storeKey"/);
      }

      for (const route of ["/", "/employee", "/employee/index.html", "/employee/portal.html", "/employee/other"]) {
        assert.equal((await fetch(`${baseUrl}${route}`)).status, 404);
      }

      const health = await fetch(`${baseUrl}/employee/healthz`);
      assert.equal(health.status, 200);
      assert.deepEqual(await health.json(), { ok: true });

      const qrCode = await fetch(`${baseUrl}/employee/assets/finance-wechat-qr.png`);
      assert.equal(qrCode.status, 200);
      assert.equal(qrCode.headers.get("content-type"), "image/png");
      assert.equal(qrCode.headers.get("x-content-type-options"), "nosniff");
      assert.ok((await qrCode.arrayBuffer()).byteLength > 0);

      for (const assetName of ["pdf.min.mjs", "pdf.worker.min.mjs"]) {
        const asset = await fetch(`${baseUrl}/employee/assets/pdfjs/${assetName}`);
        assert.equal(asset.status, 200);
        assert.match(asset.headers.get("content-type"), /javascript/);
        assert.equal(asset.headers.get("x-content-type-options"), "nosniff");
        assert.ok((await asset.arrayBuffer()).byteLength > 100_000);
      }

      assert.equal((await fetch(`${baseUrl}/employee/portal`)).status, 401);
      assert.equal(
        (await fetch(`${baseUrl}/employee/portal`, { headers: authHeaders() })).status,
        200
      );
    });
  } finally {
    harness.close();
  }
});

test("valid submissions retain duplicate phone numbers as independent records", async () => {
  const harness = createHarness();
  try {
    await withServer(harness.app, async (baseUrl) => {
      const first = await submit(baseUrl, { health: makeFile(pdfBytes(), "王晨旭的健康证.pdf", "application/pdf") });
      const second = await submit(baseUrl);
      assert.equal(first.status, 201);
      assert.equal(second.status, 201);
      const firstPayload = await first.json();
      const secondPayload = await second.json();
      assert.notEqual(firstPayload.id, secondPayload.id);
      assert.equal(harness.db.prepare("SELECT COUNT(*) AS count FROM employee_submissions").get().count, 2);
      assert.deepEqual(
        harness.db.prepare("SELECT identity_card_number FROM employee_submissions ORDER BY submit_id").all(),
        [{ identity_card_number: VALID_ID_CARD_NUMBER }, { identity_card_number: VALID_ID_CARD_NUMBER }]
      );
      assert.equal(harness.db.prepare("SELECT COUNT(*) AS count FROM employee_submission_revisions").get().count, 2);
      assert.equal(harness.db.prepare("SELECT COUNT(*) AS count FROM employee_attachment_versions").get().count, 5);
      assert.equal(listStoredFiles(harness.uploadsRoot).length, 5);
      const firstDetail = await fetch(
        `${baseUrl}/employee/api/admin/submissions/${firstPayload.id}`,
        { headers: authHeaders() }
      );
      assert.equal(
        (await firstDetail.json()).item.attachments.healthCertificate.originalName,
        "王晨旭的健康证.pdf"
      );
      const searchResponse = await fetch(
        `${baseUrl}/employee/api/admin/submissions?search=${VALID_ID_CARD_NUMBER}`,
        { headers: authHeaders() }
      );
      const searchPayload = await searchResponse.json();
      assert.equal(searchPayload.total, 2);
      assert.equal(searchPayload.items[0].identityCardNumber, VALID_ID_CARD_NUMBER);
    });
  } finally {
    harness.close();
  }
});

test("JPG PNG HEIC HEIF and PDF are accepted only when signatures match", () => {
  const cases = [
    [jpegBytes(), "photo.jpg", "image/jpeg", "image/jpeg"],
    [pngBytes(), "photo.png", "image/png", "image/png"],
    [heifBytes("heic"), "photo.heic", "image/heic", "image/heic"],
    [heifBytes("mif1"), "photo.heif", "image/heif", "image/heif"],
    [pdfBytes(), "scan.pdf", "application/pdf", "application/pdf"],
  ];
  for (const [buffer, originalname, mimetype, contentType] of cases) {
    const result = validateUploadFile(
      { buffer, originalname, mimetype, size: buffer.length },
      "attachment"
    );
    assert.equal(result.contentType, contentType);
  }

  assert.throws(
    () =>
      validateUploadFile(
        { buffer: pdfBytes(), originalname: "fake.jpg", mimetype: "image/jpeg", size: pdfBytes().length },
        "attachment"
      ),
    UploadValidationError
  );

  const mojibakeName = Buffer.from("王晨旭的健康证.pdf", "utf8").toString("latin1");
  assert.equal(normalizeUploadOriginalName(mojibakeName), "王晨旭的健康证.pdf");
  assert.equal(normalizeUploadOriginalName("café.pdf"), "café.pdf");
});

test("name phone store and required document validation returns field errors", async () => {
  const harness = createHarness();
  try {
    await withServer(harness.app, async (baseUrl) => {
      const invalidPhone = await submit(baseUrl, { phone: "123" });
      assert.equal(invalidPhone.status, 400);
      assert.equal((await invalidPhone.json()).error.field, "phone");

      const missingPosition = await submit(baseUrl, { position: "" });
      assert.equal(missingPosition.status, 400);
      assert.equal((await missingPosition.json()).error.field, "position");

      const invalidPosition = await submit(baseUrl, { position: "office" });
      assert.equal(invalidPosition.status, 400);
      assert.equal((await invalidPosition.json()).error.field, "position");

      const missingBackData = validFormData();
      missingBackData.delete("idCardBack");
      const missingBack = await fetch(`${baseUrl}/employee/api/submissions/fuzzy`, {
        method: "POST",
        body: missingBackData,
      });
      assert.equal(missingBack.status, 400);
      assert.equal((await missingBack.json()).error.field, "idCardBack");

      const invalidStore = await submit(baseUrl, {}, "unknown");
      assert.equal(invalidStore.status, 400);
      assert.equal((await invalidStore.json()).error.field, "storeKey");
      assert.equal(harness.db.prepare("SELECT COUNT(*) AS count FROM employee_submissions").get().count, 0);
    });
  } finally {
    harness.close();
  }
});

test("each file accepts exactly 20MB, three files in one request, and rejects 20MB plus one byte", async () => {
  const exact = jpegBytes(MAX_FILE_BYTES);
  assert.doesNotThrow(() =>
    validateUploadFile(
      { buffer: exact, originalname: "exact.jpg", mimetype: "image/jpeg", size: exact.length },
      "attachment"
    )
  );
  const tooLarge = jpegBytes(MAX_FILE_BYTES + 1);
  assert.throws(
    () =>
      validateUploadFile(
        { buffer: tooLarge, originalname: "large.jpg", mimetype: "image/jpeg", size: tooLarge.length },
        "attachment"
      ),
    /20MB/
  );

  const harness = createHarness();
  try {
    await withServer(harness.app, async (baseUrl) => {
      const response = await submit(baseUrl, {
        front: makeFile(exact, "front.jpg", "image/jpeg"),
        back: makeFile(exact, "back.jpg", "image/jpeg"),
        health: makeFile(exact, "health.jpg", "image/jpeg"),
      });
      const responsePayload = await response.json();
      assert.equal(response.status, 201, JSON.stringify(responsePayload));
      assert.equal(harness.db.prepare("SELECT COUNT(*) AS count FROM employee_attachment_versions").get().count, 3);

      const oversizedResponse = await submit(baseUrl, {
        front: makeFile(tooLarge, "large.jpg", "image/jpeg"),
      });
      assert.equal(oversizedResponse.status, 400);
      assert.match((await oversizedResponse.json()).error.message, /20MB/);
    });
  } finally {
    harness.close();
  }
});

test("admin APIs require configured shared Basic Auth credentials", async () => {
  const unconfigured = createHarness({ adminCredentials: { username: "", password: "" } });
  try {
    await withServer(unconfigured.app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/employee/api/admin/submissions`);
      assert.equal(response.status, 503);
      assert.equal(response.headers.get("cache-control"), "no-store");
    });
  } finally {
    unconfigured.close();
  }

  const configured = createHarness();
  try {
    await withServer(configured.app, async (baseUrl) => {
      assert.equal((await fetch(`${baseUrl}/employee/api/admin/submissions`)).status, 401);
      assert.equal(
        (await fetch(`${baseUrl}/employee/api/admin/submissions`, { headers: authHeaders("admin", "wrong") })).status,
        401
      );
      assert.equal(
        (await fetch(`${baseUrl}/employee/api/admin/submissions`, { headers: authHeaders() })).status,
        200
      );
    });
  } finally {
    configured.close();
  }
});

test("editing creates immutable field and attachment history, including removed health certificate", async () => {
  const harness = createHarness();
  try {
    await withServer(harness.app, async (baseUrl) => {
      const created = await submit(baseUrl, {
        health: makeFile(pdfBytes(), "health.pdf", "application/pdf"),
      });
      const id = (await created.json()).id;
      const initial = await fetch(`${baseUrl}/employee/api/admin/submissions/${id}`, { headers: authHeaders() });
      const initialItem = (await initial.json()).item;
      const oldFrontId = initialItem.attachments.idCardFront.attachmentVersionId;
      const oldHealthId = initialItem.attachments.healthCertificate.attachmentVersionId;

      const updateData = new FormData();
      updateData.set("name", "李四");
      updateData.set("phone", "13900000000");
      updateData.set("position", "back_of_house");
      updateData.set("storeKey", "fuzzy_qz");
      updateData.set("idCardFront", makeFile(pdfBytes(), "new-front.pdf", "application/pdf"));
      const updated = await fetch(`${baseUrl}/employee/api/admin/submissions/${id}`, {
        method: "PATCH",
        headers: authHeaders(),
        body: updateData,
      });
      assert.equal(updated.status, 200);
      const updatedItem = (await updated.json()).item;
      assert.equal(updatedItem.version, 2);
      assert.equal(updatedItem.position, "back_of_house");

      const removeHealthData = new FormData();
      removeHealthData.set("name", "李四");
      removeHealthData.set("phone", "13900000000");
      removeHealthData.set("position", "back_of_house");
      removeHealthData.set("storeKey", "fuzzy_qz");
      removeHealthData.set("removeHealthCertificate", "true");
      const removed = await fetch(`${baseUrl}/employee/api/admin/submissions/${id}`, {
        method: "PATCH",
        headers: authHeaders(),
        body: removeHealthData,
      });
      assert.equal(removed.status, 200);
      assert.equal((await removed.json()).item.attachments.healthCertificate, null);

      const history = await fetch(`${baseUrl}/employee/api/admin/submissions/${id}/history`, { headers: authHeaders() });
      const historyItems = (await history.json()).items;
      assert.equal(historyItems.length, 3);
      assert.deepEqual(historyItems.map((item) => item.action), ["updated", "updated", "created"]);
      assert.equal(historyItems[2].name, "张三");
      assert.equal(historyItems[2].position, "front_of_house");
      assert.equal(historyItems[2].attachments.idCardFront.attachmentVersionId, oldFrontId);
      assert.equal(historyItems[2].attachments.healthCertificate.attachmentVersionId, oldHealthId);

      for (const attachmentId of [oldFrontId, oldHealthId]) {
        const attachment = await fetch(`${baseUrl}/employee/api/admin/attachments/${attachmentId}`, { headers: authHeaders() });
        assert.equal(attachment.status, 200);
        assert.equal(attachment.headers.get("cache-control"), "no-store");
        assert.equal(attachment.headers.get("x-content-type-options"), "nosniff");
      }
      assert.equal(harness.db.prepare("SELECT COUNT(*) AS count FROM employee_attachment_versions").get().count, 4);
      assert.equal(listStoredFiles(harness.uploadsRoot).length, 4);
    });
  } finally {
    harness.close();
  }
});

test("soft deletion hides records, preserves files, blocks edits, and can restore the deletion-time version", async () => {
  const harness = createHarness();
  try {
    await withServer(harness.app, async (baseUrl) => {
      const created = await submit(baseUrl);
      const id = (await created.json()).id;
      const fileCount = listStoredFiles(harness.uploadsRoot).length;

      const deleted = await fetch(`${baseUrl}/employee/api/admin/submissions/${id}`, { method: "DELETE", headers: authHeaders() });
      assert.equal(deleted.status, 200);
      assert.ok((await deleted.json()).item.deletedAt);

      const active = await fetch(`${baseUrl}/employee/api/admin/submissions?status=active`, { headers: authHeaders() });
      const deletedList = await fetch(`${baseUrl}/employee/api/admin/submissions?status=deleted`, { headers: authHeaders() });
      assert.equal((await active.json()).total, 0);
      assert.equal((await deletedList.json()).total, 1);
      assert.equal(listStoredFiles(harness.uploadsRoot).length, fileCount);

      const updateData = new FormData();
      updateData.set("name", "不能编辑");
      updateData.set("phone", "13800000000");
      updateData.set("position", "front_of_house");
      updateData.set("storeKey", "fuzzy");
      const blockedEdit = await fetch(`${baseUrl}/employee/api/admin/submissions/${id}`, { method: "PATCH", headers: authHeaders(), body: updateData });
      assert.equal(blockedEdit.status, 409);

      const restored = await fetch(`${baseUrl}/employee/api/admin/submissions/${id}/restore`, { method: "POST", headers: authHeaders() });
      assert.equal(restored.status, 200);
      const restoredItem = (await restored.json()).item;
      assert.equal(restoredItem.deletedAt, null);
      assert.equal(restoredItem.version, 3);

      const history = await fetch(`${baseUrl}/employee/api/admin/submissions/${id}/history`, { headers: authHeaders() });
      assert.deepEqual((await history.json()).items.map((item) => item.action), ["restored", "deleted", "created"]);
      assert.equal(listStoredFiles(harness.uploadsRoot).length, fileCount);
      assert.equal((await fetch(`${baseUrl}/employee/api/admin/submissions/${id}/history`, { method: "DELETE", headers: authHeaders() })).status, 404);
    });
  } finally {
    harness.close();
  }
});

test("uncommitted files are removed when database persistence fails", async () => {
  const tempDir = createTempDirectory();
  const uploadsRoot = path.join(tempDir, "uploads");
  const failingDb = {
    transaction() {
      return () => {
        throw new Error("database failed");
      };
    },
  };
  try {
    await assert.rejects(
      () =>
        createEmployeeSubmission({
          body: { name: "张三", phone: "13800000000", position: "front_of_house" },
          files: {
            idCardFront: [{ buffer: jpegBytes(), originalname: "front.jpg", mimetype: "image/jpeg", size: jpegBytes().length }],
            idCardBack: [{ buffer: pngBytes(), originalname: "back.png", mimetype: "image/png", size: pngBytes().length }],
          },
          storeKey: "fuzzy",
          db: failingDb,
          uploadsRoot,
          identityCardRecognizer: async () => VALID_ID_CARD_NUMBER,
        }),
      /database failed/
    );
    assert.equal(listStoredFiles(uploadsRoot).length, 0);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("identity card recognition uses the wechat-claw compatible model request and validates the checksum", async () => {
  let requestedUrl = "";
  let requestedInit;
  const recognizer = createIdentityCardRecognizer({
    baseUrl: "https://example.com/v1/",
    apiKey: "test-key",
    model: "shared-model",
    provider: "qwen",
    fetchImpl: async (url, init) => {
      requestedUrl = url;
      requestedInit = init;
      return new Response(JSON.stringify({
        choices: [{ message: { content: `{"idCardNumber":"${VALID_ID_CARD_NUMBER}"}` } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });

  const result = await recognizer({
    buffer: jpegBytes(),
    contentType: "image/jpeg",
    originalName: "front.jpg",
  });
  assert.equal(result, VALID_ID_CARD_NUMBER);
  assert.equal(requestedUrl, "https://example.com/v1/chat/completions");
  assert.equal(requestedInit.headers.Authorization, "Bearer test-key");
  const requestBody = JSON.parse(requestedInit.body);
  assert.equal(requestBody.model, "shared-model");
  assert.equal(requestBody.response_format.type, "json_object");
  assert.match(requestBody.messages[0].content[1].image_url.url, /^data:image\/jpeg;base64,/);
  assert.equal(isValidIdentityCardNumber(VALID_ID_CARD_NUMBER), true);
  assert.equal(isValidIdentityCardNumber("110105194912310021"), false);
  assert.throws(() => parseIdentityCardNumber('{"idCardNumber":null}'), IdentityCardRecognitionError);
});

test("recognition failure keeps the submission and attachments with an empty identity card number", async () => {
  const harness = createHarness({
    identityCardRecognizer: async () => {
      throw new IdentityCardRecognitionError("无法识别", { statusCode: 422 });
    },
  });
  try {
    await withServer(harness.app, async (baseUrl) => {
      const response = await submit(baseUrl);
      assert.equal(response.status, 201);
      assert.equal((await response.json()).success, true);
      assert.deepEqual(
        harness.db.prepare("SELECT identity_card_number FROM employee_submissions").all(),
        [{ identity_card_number: null }]
      );
      assert.equal(harness.db.prepare("SELECT COUNT(*) AS count FROM employee_submission_revisions").get().count, 1);
      assert.equal(harness.db.prepare("SELECT COUNT(*) AS count FROM employee_attachment_versions").get().count, 2);
      assert.equal(listStoredFiles(harness.uploadsRoot).length, 2);
    });
  } finally {
    harness.close();
  }
});
