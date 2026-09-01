import { expect, test } from "@playwright/test";

const shot = (name: string) => `docs/screenshots/${name}.png`;

test("每日闭环：勾选 → 回想 → 到期卡 → 三问 → 结束页 → 家长页", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "今天学到哪了" })).toBeVisible();
  await page.getByRole("button", { name: "生物", exact: true }).click();
  await page.getByRole("button", { name: /第二节 生物的特征/ }).click();
  await page.screenshot({ path: shot("1-checkin") });
  await page.getByRole("button", { name: "好了" }).click();

  // 引导式回想
  await expect(page.getByText("这一节讲了什么？先想 1 分钟。")).toBeVisible();
  await page.screenshot({ path: shot("2-recall-think") });
  await page.getByRole("button", { name: "想好了" }).click();
  await expect(page.getByRole("heading", { name: "点一下没想起来的" })).toBeVisible();
  const points = page.locator("button.choice");
  expect(await points.count()).toBeGreaterThanOrEqual(3);
  await points.nth(1).click();
  await page.screenshot({ path: shot("3-recall-compare") });
  await page.getByRole("button", { name: /1 条明天再看/ }).click();

  // 到期卡：先看答案再点会/不会
  await expect(page.getByRole("button", { name: "看答案" })).toBeVisible();
  await page.screenshot({ path: shot("4-review-front") });
  let n = 0;
  for (; n < 80; n++) {
    const look = page.getByRole("button", { name: "看答案" });
    const reflect = page.getByRole("heading", { name: "今天最卡的一点？" });
    await expect(look.or(reflect)).toBeVisible({ timeout: 10_000 });
    if (await reflect.isVisible()) break;
    await look.click();
    if (n === 0) { await expect(page.getByRole("button", { name: "会", exact: true })).toBeVisible(); await page.screenshot({ path: shot("5-review-back") }); }
    await page.getByRole("button", { name: n % 5 === 4 ? "不会" : "会", exact: true }).click();
    await expect(page.getByText(/^(对了。|再看一眼)/)).toBeVisible();
    if (n === 1) {
      // 作答后才解锁讲解（硬约束 2）
      await page.getByRole("button", { name: /讲解（今天还有 5 次）/ }).click();
      await expect(page.getByText(/测试讲解/)).toBeVisible({ timeout: 10_000 });
      await page.screenshot({ path: shot("5b-explain") });
    }
    await page.getByRole("button", { name: "下一题" }).click();
  }
  expect(n).toBeGreaterThan(3);

  // 三问
  await expect(page.getByRole("heading", { name: "今天最卡的一点？" })).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: shot("6-reflect") });
  await page.locator("button.choice").first().click();
  await page.getByRole("button", { name: "没有" }).click();
  await page.locator("button.choice").first().click();

  // 结束页
  await expect(page.getByText(/今天 \d+ 题，\d+ 张卡明天到期。/)).toBeVisible();
  await page.screenshot({ path: shot("7-done") });
  await page.getByRole("button", { name: "结束" }).click();
  await expect(page.getByText("明天见。")).toBeVisible();

  // 家长页
  await page.goto("/parent");
  await expect(page.getByRole("heading", { name: "这一周" })).toBeVisible();
  await expect(page.getByText("1 / 5")).toBeVisible();
  await page.screenshot({ path: shot("8-parent") });
  const body = await page.textContent("body");
  expect(body).not.toMatch(/分钟|报班/);
});

test("家长页：录入两次成绩后出现位次趋势", async ({ page, request }) => {
  await request.post("/api/parent/exams", { data: { date: "2026-10-09", name: "月考", subject: "总分", score: 580, fullScore: 700, classRank: 12, classSize: 45 } });
  await page.goto("/parent");
  await page.getByLabel("日期").fill("2026-11-10");
  await page.getByLabel("考试名称（期中 / 期末 / 月考）").fill("期中");
  await page.getByLabel("分数").fill("612");
  await page.getByLabel("满分").fill("700");
  await page.getByLabel("班级排名").fill("8");
  await page.getByLabel("班级人数").fill("45");
  await page.getByRole("button", { name: "记录这次考试" }).click();
  await expect(page.getByText("已记录。")).toBeVisible();
  await expect(page.getByRole("img", { name: "总分 班级位次趋势" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "期中" })).toBeVisible();
  await page.screenshot({ path: "docs/screenshots/9-parent-exams.png", fullPage: true });
});

test("没作答的题不能要讲解（API 门控）", async ({ request }) => {
  // 这条内容存在于库里，但这一天没有作答过
  const itemId = "recitation:潼关:1:fill"; // 引入日在学期末，第一天不会出现在队列里
  const gate = await (await request.get(`/api/explain/gate/${encodeURIComponent(itemId)}`)).json() as { allowed: boolean; reason: string };
  expect(gate).toMatchObject({ allowed: false, reason: "not_answered" });
  const r = await request.post("/api/explain", { data: { itemId } });
  expect(r.status()).toBe(403);
});
