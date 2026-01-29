import { createClient } from '@supabase/supabase-js';

interface GeoData {
  country: string | null;
  region: string | null;
  city: string | null;
}

interface DeviceInfo {
  deviceType: string;
  browser: string;
  os: string;
  screenWidth: number;
  screenHeight: number;
}

interface AnalyticsState {
  visitorId: string;
  sessionId: string;
  isLandingPage: boolean;
  pageStartTime: number;
  maxScrollDepth: number;
  currentPageVisitId: string | null;
  geoData: GeoData | null;
  deviceInfo: DeviceInfo | null;
}

const STORAGE_KEY_VISITOR = 'bgs_visitor_id';
const STORAGE_KEY_SESSION = 'bgs_session';
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

class Analytics {
  private state: AnalyticsState;
  private supabase: ReturnType<typeof createClient>;
  private isInitialized = false;

  constructor() {
    const supabaseUrl = (window as unknown as { ENV_SUPABASE_URL?: string }).ENV_SUPABASE_URL || '';
    const supabaseKey = (window as unknown as { ENV_SUPABASE_ANON_KEY?: string }).ENV_SUPABASE_ANON_KEY || '';

    this.supabase = createClient(supabaseUrl, supabaseKey);

    this.state = {
      visitorId: '',
      sessionId: '',
      isLandingPage: false,
      pageStartTime: Date.now(),
      maxScrollDepth: 0,
      currentPageVisitId: null,
      geoData: null,
      deviceInfo: null
    };
  }

  async init(): Promise<void> {
    if (this.isInitialized) return;

    this.state.visitorId = this.getOrCreateVisitorId();
    const sessionData = this.getOrCreateSession();
    this.state.sessionId = sessionData.sessionId;
    this.state.isLandingPage = sessionData.isNewSession;
    this.state.deviceInfo = this.getDeviceInfo();

    await this.fetchGeoData();
    await this.trackPageVisit();

    this.setupScrollTracking();
    this.setupVisibilityTracking();
    this.setupBeforeUnload();

    this.isInitialized = true;
  }

  private generateFingerprint(): string {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.textBaseline = 'top';
      ctx.font = '14px Arial';
      ctx.fillText('fingerprint', 2, 2);
    }

    const components = [
      navigator.userAgent,
      navigator.language,
      screen.width + 'x' + screen.height,
      screen.colorDepth,
      new Date().getTimezoneOffset(),
      !!window.sessionStorage,
      !!window.localStorage,
      canvas.toDataURL()
    ];

    let hash = 0;
    const str = components.join('|');
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }

    return 'v_' + Math.abs(hash).toString(36);
  }

  private getOrCreateVisitorId(): string {
    let visitorId = localStorage.getItem(STORAGE_KEY_VISITOR);
    if (!visitorId) {
      visitorId = this.generateFingerprint();
      localStorage.setItem(STORAGE_KEY_VISITOR, visitorId);

      this.supabase.from('visitors').insert({
        visitor_id: visitorId
      }).then(() => {});
    }
    return visitorId;
  }

  private getOrCreateSession(): { sessionId: string; isNewSession: boolean } {
    const stored = sessionStorage.getItem(STORAGE_KEY_SESSION);
    const now = Date.now();

    if (stored) {
      const data = JSON.parse(stored);
      if (now - data.lastActivity < SESSION_TIMEOUT_MS) {
        data.lastActivity = now;
        data.pageCount++;
        sessionStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(data));

        this.supabase.from('sessions')
          .update({ page_count: data.pageCount })
          .eq('session_id', data.sessionId)
          .then(() => {});

        return { sessionId: data.sessionId, isNewSession: false };
      }
    }

    const sessionId = 's_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 9);
    const sessionData = {
      sessionId,
      startTime: now,
      lastActivity: now,
      pageCount: 1
    };
    sessionStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(sessionData));

    return { sessionId, isNewSession: true };
  }

  private getDeviceInfo(): DeviceInfo {
    const ua = navigator.userAgent;
    let deviceType = 'desktop';
    if (/tablet|ipad|playbook|silk/i.test(ua)) {
      deviceType = 'tablet';
    } else if (/mobile|iphone|ipod|android|blackberry|opera mini|iemobile/i.test(ua)) {
      deviceType = 'mobile';
    }

    let browser = 'unknown';
    if (ua.includes('Firefox')) browser = 'Firefox';
    else if (ua.includes('SamsungBrowser')) browser = 'Samsung';
    else if (ua.includes('Opera') || ua.includes('OPR')) browser = 'Opera';
    else if (ua.includes('Edge')) browser = 'Edge';
    else if (ua.includes('Chrome')) browser = 'Chrome';
    else if (ua.includes('Safari')) browser = 'Safari';

    let os = 'unknown';
    if (ua.includes('Windows')) os = 'Windows';
    else if (ua.includes('Mac')) os = 'macOS';
    else if (ua.includes('Linux')) os = 'Linux';
    else if (ua.includes('Android')) os = 'Android';
    else if (ua.includes('iOS') || ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';

    return {
      deviceType,
      browser,
      os,
      screenWidth: window.screen.width,
      screenHeight: window.screen.height
    };
  }

  private async fetchGeoData(): Promise<void> {
    try {
      const response = await fetch('https://ipapi.co/json/', {
        signal: AbortSignal.timeout(3000)
      });
      if (response.ok) {
        const data = await response.json();
        this.state.geoData = {
          country: data.country_name || null,
          region: data.region || null,
          city: data.city || null
        };
      }
    } catch {
      this.state.geoData = { country: null, region: null, city: null };
    }
  }

  private getReferrerDomain(): string | null {
    if (!document.referrer) return null;
    try {
      const url = new URL(document.referrer);
      if (url.hostname === window.location.hostname) return null;
      return url.hostname;
    } catch {
      return null;
    }
  }

  private async trackPageVisit(): Promise<void> {
    const { visitorId, sessionId, isLandingPage, deviceInfo, geoData } = this.state;

    if (isLandingPage) {
      await this.supabase.from('sessions').insert({
        session_id: sessionId,
        visitor_id: visitorId,
        landing_page: window.location.pathname,
        referrer: document.referrer || null,
        referrer_domain: this.getReferrerDomain(),
        country: geoData?.country || null,
        region: geoData?.region || null,
        city: geoData?.city || null,
        device_type: deviceInfo?.deviceType || null,
        browser: deviceInfo?.browser || null,
        os: deviceInfo?.os || null,
        screen_width: deviceInfo?.screenWidth || null,
        screen_height: deviceInfo?.screenHeight || null
      });
    }

    const { data } = await this.supabase.from('page_visits').insert({
      session_id: sessionId,
      visitor_id: visitorId,
      page_path: window.location.pathname,
      page_title: document.title,
      referrer: document.referrer || null,
      referrer_domain: this.getReferrerDomain(),
      is_landing_page: isLandingPage,
      country: geoData?.country || null,
      region: geoData?.region || null,
      city: geoData?.city || null,
      device_type: deviceInfo?.deviceType || null,
      browser: deviceInfo?.browser || null,
      os: deviceInfo?.os || null,
      screen_width: deviceInfo?.screenWidth || null,
      screen_height: deviceInfo?.screenHeight || null
    }).select('id').single();

    if (data) {
      this.state.currentPageVisitId = data.id;
    }
  }

  private setupScrollTracking(): void {
    const updateScrollDepth = () => {
      const windowHeight = window.innerHeight;
      const documentHeight = document.documentElement.scrollHeight;
      const scrollTop = window.scrollY;
      const scrollPercent = Math.min(100, Math.round((scrollTop + windowHeight) / documentHeight * 100));
      if (scrollPercent > this.state.maxScrollDepth) {
        this.state.maxScrollDepth = scrollPercent;
      }
    };

    window.addEventListener('scroll', updateScrollDepth, { passive: true });
    updateScrollDepth();
  }

  private setupVisibilityTracking(): void {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.savePageMetrics();
      }
    });
  }

  private setupBeforeUnload(): void {
    window.addEventListener('beforeunload', () => {
      this.savePageMetrics();
    });
  }

  private savePageMetrics(): void {
    if (!this.state.currentPageVisitId) return;

    const timeOnPage = Math.round((Date.now() - this.state.pageStartTime) / 1000);

    navigator.sendBeacon(
      `${(window as unknown as { ENV_SUPABASE_URL?: string }).ENV_SUPABASE_URL}/rest/v1/page_visits?id=eq.${this.state.currentPageVisitId}`,
      JSON.stringify({
        time_on_page_seconds: timeOnPage,
        scroll_depth_percent: this.state.maxScrollDepth,
        is_exit_page: true
      })
    );

    const sessionData = sessionStorage.getItem(STORAGE_KEY_SESSION);
    if (sessionData) {
      const data = JSON.parse(sessionData);
      navigator.sendBeacon(
        `${(window as unknown as { ENV_SUPABASE_URL?: string }).ENV_SUPABASE_URL}/rest/v1/sessions?session_id=eq.${this.state.sessionId}`,
        JSON.stringify({
          exit_page: window.location.pathname,
          is_bounce: data.pageCount === 1
        })
      );
    }
  }
}

const analytics = new Analytics();

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => analytics.init());
  } else {
    analytics.init();
  }
}

export { analytics };
