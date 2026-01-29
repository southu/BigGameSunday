export interface AnalyticsSummary {
  totalVisits: number;
  uniqueVisitors: number;
  totalSessions: number;
  avgTimeOnSite: number;
  avgPagesPerSession: number;
  bounceRate: number;
  newVisitorRate: number;
}

export interface PageMetrics {
  path: string;
  title: string | null;
  visits: number;
  uniqueVisitors: number;
  avgTimeOnPage: number;
  bounceRate: number;
  exitRate: number;
}

export interface LandingPageMetrics {
  path: string;
  title: string | null;
  sessions: number;
  bounceRate: number;
  avgSessionDuration: number;
  topReferrers: ReferrerMetrics[];
  nextPages: NextPageMetrics[];
}

export interface ReferrerMetrics {
  domain: string | null;
  url: string | null;
  visits: number;
}

export interface NextPageMetrics {
  path: string;
  count: number;
  percentage: number;
}

export interface CountryMetrics {
  country: string;
  visits: number;
  uniqueVisitors: number;
  avgTimeOnSite: number;
  bounceRate: number;
  topLandingPages: { path: string; count: number }[];
}

export interface SessionDetail {
  sessionId: string;
  visitorId: string;
  startedAt: string;
  endedAt: string | null;
  duration: number;
  pageCount: number;
  landingPage: string | null;
  exitPage: string | null;
  country: string | null;
  deviceType: string | null;
  pages: SessionPageVisit[];
}

export interface SessionPageVisit {
  path: string;
  title: string | null;
  visitedAt: string;
  timeOnPage: number;
  scrollDepth: number;
}

export interface RealtimeVisitor {
  visitorId: string;
  sessionId: string;
  currentPage: string;
  country: string | null;
  deviceType: string | null;
  lastActivity: string;
}

export interface DateRange {
  start: Date;
  end: Date;
}

export interface AnalyticsFilters {
  dateRange: DateRange;
  countries?: string[];
  deviceTypes?: string[];
  browsers?: string[];
  landingPages?: string[];
}

export interface ChartDataPoint {
  date: string;
  value: number;
}

export interface VisitsChartData {
  visits: ChartDataPoint[];
  uniqueVisitors: ChartDataPoint[];
  sessions: ChartDataPoint[];
}

export interface DeviceBreakdown {
  desktop: number;
  mobile: number;
  tablet: number;
}

export interface BrowserBreakdown {
  [browser: string]: number;
}

export interface GeoData {
  country: string;
  region?: string;
  city?: string;
  visits: number;
}
