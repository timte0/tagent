import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SourceType } from "@/app/generated/prisma/client";
import { PDFParse } from "pdf-parse";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session.orgId) return NextResponse.json({ jobs: [] });

  const jobs = await prisma.job.findMany({
    where: { orgId: session.orgId },
    orderBy: { createdAt: "desc" },
    include: {
      user: { select: { email: true } },
      _count: { select: { runs: true } },
    },
  });

  return NextResponse.json({ jobs });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session.orgId) return NextResponse.json({ error: "No organization" }, { status: 400 });

  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const title = (formData.get("title") as string | null) ?? null;

    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });
    if (file.type !== "application/pdf") {
      return NextResponse.json({ error: "Only PDF files are accepted" }, { status: 400 });
    }
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "File size must be under 10 MB" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    let rawContent: string;
    try {
      const parser = new PDFParse({ data: buffer });
      const result = await parser.getText();
      await parser.destroy();
      rawContent = result.text?.trim() ?? "";
    } catch (err) {
      console.error("[pdf-parse error]", err);
      return NextResponse.json(
        { error: "Failed to extract text from PDF" },
        { status: 422 },
      );
    }

    if (!rawContent) {
      return NextResponse.json(
        { error: "PDF appears to have no extractable text" },
        { status: 422 },
      );
    }

    const job = await prisma.job.create({
      data: {
        orgId: session.orgId,
        userId: session.id,
        title: title?.trim() || null,
        sourceType: SourceType.PDF,
        rawContent,
      },
    });

    return NextResponse.json({ job }, { status: 201 });
  }

  // URL input
  const body = await req.json().catch(() => ({}));
  const { url, title } = body as { url?: string; title?: string };

  if (!url) return NextResponse.json({ error: "URL is required" }, { status: 400 });

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    return NextResponse.json(
      { error: "URL must use http or https" },
      { status: 400 },
    );
  }

  let rawContent: string;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; TagentBot/1.0)" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    rawContent = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Could not fetch URL: ${message}` },
      { status: 422 },
    );
  }

  if (!rawContent) {
    return NextResponse.json(
      { error: "No content found at the provided URL" },
      { status: 422 },
    );
  }

  const job = await prisma.job.create({
    data: {
      orgId: session.orgId,
      userId: session.id,
      title: title?.trim() || null,
      sourceType: SourceType.URL,
      rawContent,
      sourceUrl: url,
    },
  });

  return NextResponse.json({ job }, { status: 201 });
}
