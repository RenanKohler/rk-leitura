import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { extractTextFromHtml } from "@/lib/parser";

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { url } = body;

    if (!url) {
      return NextResponse.json({ error: "URL required" }, { status: 400 });
    }

    // Validate URL
    try {
      new URL(url);
    } catch {
      return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
    }

    // Fetch the URL
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Wordrunner/1.0 (speed reading app)",
        "Accept": "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      return NextResponse.json({ error: `Failed to fetch URL: ${response.status}` }, { status: 400 });
    }

    const html = await response.text();
    const parsed = extractTextFromHtml(html, url);

    if (parsed.wordCount < 10) {
      return NextResponse.json({ error: "Not enough content found on the page" }, { status: 400 });
    }

    return NextResponse.json({
      title: parsed.title,
      content: parsed.content,
      wordCount: parsed.wordCount,
    });
  } catch (error) {
    console.error("Import URL error:", error);
    return NextResponse.json({ error: "Failed to import URL" }, { status: 500 });
  }
}
