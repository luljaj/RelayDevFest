import { NextRequest, NextResponse } from 'next/server';
import { cleanupExpiredLocks } from '@/lib/locks';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const cleaned = await cleanupExpiredLocks();

    return NextResponse.json({
      success: true,
      cleaned,
      timestamp: Date.now(),
    });
  } catch (error) {
    const details = error instanceof Error ? error.message : 'Unknown error';
    console.error('Cleanup job error:', error);
    return NextResponse.json({ error: 'Cleanup failed', details }, { status: 500 });
  }
}
