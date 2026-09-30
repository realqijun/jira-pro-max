import { expect, test, type Locator } from "@playwright/test";

const chapterTitles = [
  "Stand above the whole thing",
  "The outline has depth",
  "Decisions are load-bearing",
  "Down to the single room",
  "Everything is wired to everything",
];

/** The descent film; the stage also holds the prologue's prism clip. */
const film = (section: Locator) => section.locator('video[poster="/landing/prismpm-scroll-poster.jpg"]');

/** Scroll the pinned stage to `fraction` of the descent, past the prologue's screens. */
async function scrollDescent(section: Locator, fraction: number) {
  await section
    .locator(".relative")
    .first()
    .evaluate(
      (stage, { fraction, chapters }) => {
        const screens = Math.round(stage.clientHeight / innerHeight);
        const prologueShare = (screens - chapters) / screens;
        const progress = prologueShare + (1 - prologueShare) * fraction;
        const start = stage.getBoundingClientRect().top + window.scrollY;
        window.scrollTo({ top: start + (stage.clientHeight - innerHeight) * progress, behavior: "instant" });
      },
      { fraction, chapters: chapterTitles.length },
    );
}

for (const viewport of [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 820, height: 768 },
  { width: 1280, height: 600 },
]) {
  test(`all five film chapters remain readable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const section = page.locator("#how");
    if (viewport.height >= 544) await expect(section.locator(".sticky")).toBeVisible();
    for (const [index, title] of chapterTitles.entries()) {
      if (viewport.height >= 544) await scrollDescent(section, (index + 0.3) / chapterTitles.length);
      const heading = section.getByRole("heading", { name: title, exact: true });
      await expect(heading).toBeVisible();
      if (viewport.height < 544) {
        await heading.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
      }
      await expect(heading).toBeInViewport({ ratio: 1 });
      const box = await heading.boundingBox();
      const header = await page.getByRole("banner").boundingBox();
      expect(box!.y).toBeGreaterThanOrEqual(header!.height);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
  });
}

test("desktop scrubbing survives compact and reduced-motion viewports", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const section = page.locator("#how");
  const video = film(section);
  await expect(section.locator(".sticky")).toBeVisible();
  await scrollDescent(section, 0.5);
  await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.readyState)).toBeGreaterThanOrEqual(2);
  await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.currentTime)).toBeGreaterThan(1);
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(section.getByRole("heading", { level: 3 })).toHaveCount(5);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(section.getByRole("heading", { level: 3 })).toHaveCount(1);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(section.getByRole("heading", { level: 3 })).toHaveCount(5);
});

test("missing video leaves all chapters readable", async ({ page }) => {
  await page.route("**/landing/prismpm-scroll.mp4", (route) => route.abort());
  await page.goto("/");
  await page.locator("#how").scrollIntoViewIfNeeded();
  await expect(page.locator("#how").getByRole("heading", { level: 3 })).toHaveCount(5);
  await expect(page.locator("#how video")).toHaveCount(0);
});

test("the phone hero does not download the film until it enters view", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const downloads: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/landing/prismpm-scroll.mp4")) downloads.push(request.url());
  });
  await page.goto("/");
  await expect(page.locator("#how .sticky")).toBeVisible();
  expect(downloads).toHaveLength(0);
  await page.locator("#how").evaluate((el) => el.scrollIntoView({ behavior: "instant" }));
  await expect.poll(() => downloads.length).toBeGreaterThan(0);
  await expect
    .poll(() => film(page.locator("#how")).evaluate((el: HTMLVideoElement) => el.readyState))
    .toBeGreaterThanOrEqual(2);
});

test("without JavaScript the chapters, pricing and signup remain available", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.locator("#how").getByRole("heading", { level: 3 })).toHaveCount(5);
  await expect(page.getByRole("heading", { name: "Start with a real project." })).toBeVisible();
  await page.getByRole("link", { name: "Try the research preview" }).click();
  await expect(page).toHaveURL(/\/signup$/);
  await context.close();
});

test("phone navigation reaches readable pricing and signup", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("navigation", { name: "Mobile navigation" }).getByRole("link", { name: "Pricing" }).click();
  await expect(page.getByRole("button", { name: "Open menu" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Start with a real project." })).toBeInViewport({ ratio: 1 });
  await expect(page.locator("#pricing")).toContainText("no paid subscription is offered today");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.getByRole("link", { name: "Try the research preview" }).click();
  await expect(page).toHaveURL(/\/signup$/);
});

test("signup opens a workspace and changes every primary CTA", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  for (const link of await page
    .getByRole("link", { name: /Create an account|Get started|Try the research preview/ })
    .all()) {
    await expect(link).toHaveAttribute("href", "/signup");
  }
  await page.getByRole("link", { name: "Get started", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Landing verification");
  await page.getByLabel("Email").fill(`landing-${Date.now()}@test.local`);
  await page.getByLabel("Password").fill("landing-verification-123");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
  await page.goto("/");
  const workspaceLinks = page.getByRole("link", { name: /Open (your )?workspace/ });
  await expect(workspaceLinks).toHaveCount(4);
  for (const link of await workspaceLinks.all()) await expect(link).toHaveAttribute("href", "/dashboard");
  await page.locator("#pricing").getByRole("link", { name: "Open your workspace" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("anonymous dashboard access redirects to sign-in", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
});

test("metadata, social image and crawl routes share the canonical origin", async ({ page, request }) => {
  const origin = new URL(process.env.SITE_URL || "http://localhost:3000").origin;
  await page.goto("/");
  await expect(page).toHaveTitle("PrismPM - project management with a memory");
  expect(new URL((await page.locator('link[rel="canonical"]').getAttribute("href"))!).href).toBe(origin + "/");
  expect(new URL((await page.locator('meta[property="og:url"]').getAttribute("content"))!).href).toBe(origin + "/");
  await expect(page.locator('meta[property="og:type"]')).toHaveAttribute("content", "website");
  await expect(page.locator('meta[property="og:description"]')).toHaveAttribute(
    "content",
    /Tasks, Decisions and Evidence/,
  );
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
  for (const selector of ['meta[property="og:image"]', 'meta[name="twitter:image"]']) {
    const url = new URL((await page.locator(selector).getAttribute("content"))!);
    expect(url.origin).toBe(origin);
    const image = await request.get(url.pathname + url.search);
    expect(image.status()).toBe(200);
    expect(image.headers()["content-type"]).toContain("image/png");
    const bytes = await image.body();
    expect(bytes.readUInt32BE(16)).toBe(1200);
    expect(bytes.readUInt32BE(20)).toBe(630);
  }
  await expect(page.locator('meta[property="og:image:alt"]')).toHaveAttribute("content", /PrismPM/);
  const robots = await request.get("/robots.txt");
  expect(robots.status()).toBe(200);
  expect(await robots.text()).toContain(`Sitemap: ${origin}/sitemap.xml`);
  for (const route of ["/projects", "/api/", "/invite/", "/m/", "/settings"]) {
    expect(await robots.text()).toContain(`Disallow: ${route}`);
  }
  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.status()).toBe(200);
  expect((await sitemap.text()).match(/<loc>[^<]+<\/loc>/g)).toEqual([`<loc>${origin}/</loc>`]);
});
