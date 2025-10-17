import { SchemaFieldDataType } from '@app/businessAttribute/businessAttributeUtils';
import { GetDatasetQuery } from '@graphql/dataset.generated';

// The generated GraphQL types are not available in this sandbox, so we declare the
// minimal shapes that we rely on when deriving time series metadata. These are
// intentionally permissive because the GraphQL responses contain many optional fields.
type Maybe<T> = T | null | undefined;

export interface DatasetFieldProfile {
    fieldPath?: Maybe<string>;
    min?: Maybe<string>;
    max?: Maybe<string>;
    mean?: Maybe<number>;
    median?: Maybe<number>;
    stdev?: Maybe<number>;
    nullProportion?: Maybe<number>;
    uniqueCount?: Maybe<number>;
    uniqueProportion?: Maybe<number>;
    sampleValues?: Maybe<Array<Maybe<string>>>;
}

export interface DatasetProfileSummary {
    rowCount?: Maybe<number>;
    columnCount?: Maybe<number>;
    sizeInBytes?: Maybe<number>;
    timestampMillis?: Maybe<number>;
    fieldProfiles?: Maybe<Array<Maybe<DatasetFieldProfile>>>;
}

export interface SchemaFieldSummary {
    fieldPath?: Maybe<string>;
    label?: Maybe<string>;
    description?: Maybe<string>;
    type?: Maybe<SchemaFieldDataType | string>;
    nativeDataType?: Maybe<string>;
}

interface CustomProperty {
    key?: Maybe<string>;
    value?: Maybe<string>;
}

export interface TimeseriesCustomConfigEntry {
    label: string;
    value: string;
}

export interface TimeseriesCustomConfig {
    timestampColumn?: string;
    timezone?: string;
    frequency?: string;
    metadataEntries: TimeseriesCustomConfigEntry[];
    columnMetadata: Record<string, Record<string, string>>;
}

const TIMESERIES_PREFIX = 'timeseries.';
const COLUMN_PREFIX = `${TIMESERIES_PREFIX}column.`;

const KEY_LABEL_MAP: Record<string, string> = {
    'timeseries.timestamp_column': 'Timestamp column',
    'timeseries.primary_timestamp_column': 'Timestamp column',
    'timeseries.time_column': 'Timestamp column',
    'timeseries.timezone': 'Time zone',
    'timeseries.time_zone': 'Time zone',
    'timeseries.frequency': 'Sampling interval',
    'timeseries.sampling_interval': 'Sampling interval',
    'timeseries.sensor_id': 'Sensor ID',
    'timeseries.location': 'Location',
    'timeseries.instrument': 'Instrument',
    'timeseries.measurement': 'Measurement',
    'timeseries.units': 'Units',
    'timeseries.source': 'Source',
    'timeseries.description': 'Description',
    'timeseries.notes': 'Notes',
};

const SPECIAL_KEYS = new Set([
    'timeseries.timestamp_column',
    'timeseries.primary_timestamp_column',
    'timeseries.time_column',
    'timeseries.timezone',
    'timeseries.time_zone',
    'timeseries.frequency',
    'timeseries.sampling_interval',
]);

const TWO_LETTER_UPPER = new Set(['id', 'tz', 'hr', 'qc', 'qa', 'uv', 'ph', 'co', 'co2', 'no', 'no2', 'pm']);

const NUMERIC_REGEX = /^-?\d+(?:\.\d+)?$/;

const sanitizeColumnSegment = (segment: string) => segment.replace(/`/g, '').trim();

export const normalizeFieldPath = (fieldPath?: Maybe<string>): string => {
    if (!fieldPath) {
        return '';
    }
    const sanitized = fieldPath
        .split('.')
        .map((segment) => sanitizeColumnSegment(segment))
        .filter((segment) => segment.length > 0)
        .join('.');
    return sanitized.toLowerCase();
};

const formatTimeseriesLabel = (raw: string) => {
    return raw
        .split(/[._-]+/)
        .filter((segment) => segment.length > 0)
        .map((segment) => {
            const lower = segment.toLowerCase();
            if (segment.length <= 3 || TWO_LETTER_UPPER.has(lower)) {
                return lower.toUpperCase();
            }
            return lower.charAt(0).toUpperCase() + lower.slice(1);
        })
        .join(' ');
};

export const isNumericValue = (value: Maybe<string | number>): boolean => {
    if (value === null || value === undefined) {
        return false;
    }
    if (typeof value === 'number') {
        return Number.isFinite(value);
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return false;
    }
    if (!NUMERIC_REGEX.test(trimmed)) {
        return false;
    }
    const numeric = Number(trimmed);
    return !Number.isNaN(numeric) && Number.isFinite(numeric);
};

export const parseDateToMillis = (value?: Maybe<string>): number | null => {
    if (!value) {
        return null;
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }

    if (/^\d{8}$/.test(trimmed)) {
        const year = Number(trimmed.slice(0, 4));
        const month = Number(trimmed.slice(4, 6)) - 1;
        const day = Number(trimmed.slice(6, 8));
        const date = new Date(year, month, day);
        return Number.isNaN(date.getTime()) ? null : date.getTime();
    }

    if (/^\d{14}$/.test(trimmed)) {
        const year = Number(trimmed.slice(0, 4));
        const month = Number(trimmed.slice(4, 6)) - 1;
        const day = Number(trimmed.slice(6, 8));
        const hour = Number(trimmed.slice(8, 10));
        const minute = Number(trimmed.slice(10, 12));
        const second = Number(trimmed.slice(12, 14));
        const date = new Date(year, month, day, hour, minute, second);
        return Number.isNaN(date.getTime()) ? null : date.getTime();
    }

    if (NUMERIC_REGEX.test(trimmed)) {
        const numeric = Number(trimmed);
        if (!Number.isFinite(numeric)) {
            return null;
        }
        if (Math.abs(numeric) < 1e5) {
            return null;
        }
        if (trimmed.length <= 10) {
            return numeric * 1000;
        }
        return numeric;
    }

    const parsed = Date.parse(trimmed);
    return Number.isNaN(parsed) ? null : parsed;
};

export const isParsableDate = (value?: Maybe<string>) => parseDateToMillis(value) !== null;

export const hasNumericStats = (profile?: Maybe<DatasetFieldProfile>): boolean => {
    if (!profile) {
        return false;
    }
    const numericCandidates: Array<Maybe<string | number>> = [
        profile.mean,
        profile.max,
        profile.min,
        profile.median,
        profile.stdev,
        profile.uniqueCount,
        profile.uniqueProportion,
    ];
    if (numericCandidates.some((candidate) => isNumericValue(candidate))) {
        return true;
    }
    if (profile.sampleValues) {
        return profile.sampleValues.filter((value) => value !== null && value !== undefined).some((value) => isNumericValue(value || ''));
    }
    return false;
};

export const getLatestProfileFromDataset = (
    dataset?: Maybe<GetDatasetQuery['dataset']>,
): Maybe<DatasetProfileSummary> => {
    if (!dataset) {
        return undefined;
    }
    const latestFull = dataset.latestFullTableProfile?.[0];
    if (latestFull) {
        return latestFull as DatasetProfileSummary;
    }
    const latestPartition = dataset.latestPartitionProfile?.[0];
    if (latestPartition) {
        return latestPartition as DatasetProfileSummary;
    }
    const firstProfile = dataset.datasetProfiles?.[0];
    return (firstProfile as DatasetProfileSummary) || undefined;
};

export const extractTimeseriesCustomConfig = (
    customProperties?: Maybe<Array<Maybe<CustomProperty>>>,
): TimeseriesCustomConfig => {
    const metadataEntries: TimeseriesCustomConfigEntry[] = [];
    const columnMetadata: Record<string, Record<string, string>> = {};

    let timestampColumn: string | undefined;
    let timezone: string | undefined;
    let frequency: string | undefined;

    (customProperties || []).forEach((prop) => {
        if (!prop?.key || prop.value === undefined || prop.value === null) {
            return;
        }
        const rawKey = prop.key;
        const key = rawKey.toLowerCase();
        const value = String(prop.value);

        if (key === 'timeseries.timestamp_column' || key === 'timeseries.primary_timestamp_column' || key === 'timeseries.time_column') {
            timestampColumn = value;
        }
        if (key === 'timeseries.timezone' || key === 'timeseries.time_zone') {
            timezone = value;
        }
        if (key === 'timeseries.frequency' || key === 'timeseries.sampling_interval') {
            frequency = value;
        }

        if (key.startsWith(COLUMN_PREFIX)) {
            const remainder = key.slice(COLUMN_PREFIX.length);
            const [columnSegment, ...rest] = remainder.split('.');
            if (!columnSegment || rest.length === 0) {
                return;
            }
            const normalizedColumn = normalizeFieldPath(columnSegment);
            if (!columnMetadata[normalizedColumn]) {
                columnMetadata[normalizedColumn] = {};
            }
            const metadataKey = rest.join('.');
            columnMetadata[normalizedColumn][metadataKey] = value;
            return;
        }

        if (key.startsWith(TIMESERIES_PREFIX) && !SPECIAL_KEYS.has(key)) {
            const label = KEY_LABEL_MAP[key] || formatTimeseriesLabel(key.slice(TIMESERIES_PREFIX.length));
            metadataEntries.push({
                label,
                value,
            });
        }
    });

    return {
        timestampColumn,
        timezone,
        frequency,
        metadataEntries,
        columnMetadata,
    };
};

const hasTimeLikeProfile = (profile?: Maybe<DatasetFieldProfile>): boolean => {
    if (!profile) {
        return false;
    }
    if (isParsableDate(profile.min) || isParsableDate(profile.max)) {
        return true;
    }
    if (profile.sampleValues) {
        return profile.sampleValues.some((value) => isParsableDate(value || undefined));
    }
    return false;
};

export const isTimeseriesDataset = (data?: Maybe<GetDatasetQuery>): boolean => {
    if (!data?.dataset) {
        return false;
    }
    const dataset = data.dataset;
    const config = extractTimeseriesCustomConfig(dataset.properties?.customProperties as any);
    if (config.timestampColumn) {
        return true;
    }
    const profile = getLatestProfileFromDataset(dataset as any);
    if (!profile?.fieldProfiles) {
        return false;
    }
    const profiles = profile.fieldProfiles.filter((field) => field) as DatasetFieldProfile[];
    if (profiles.length === 0) {
        return false;
    }
    const hasTime = profiles.some((fieldProfile) => hasTimeLikeProfile(fieldProfile));
    if (!hasTime) {
        return false;
    }
    return profiles.some((fieldProfile) => hasNumericStats(fieldProfile));
};
