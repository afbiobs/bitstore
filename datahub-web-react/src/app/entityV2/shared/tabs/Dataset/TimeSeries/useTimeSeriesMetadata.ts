import { useMemo } from 'react';

import { useBaseEntity } from '@app/entity/shared/EntityContext';
import { useGetEntityWithSchema } from '@app/entityV2/shared/tabs/Dataset/Schema/useGetEntitySchema';
import { formatDuration } from '@app/shared/formatDuration';
import { GetDatasetQuery } from '@graphql/dataset.generated';

import {
    DatasetFieldProfile,
    DatasetProfileSummary,
    SchemaFieldSummary,
    TimeseriesCustomConfigEntry,
    extractTimeseriesCustomConfig,
    getLatestProfileFromDataset,
    hasNumericStats,
    isParsableDate,
    normalizeFieldPath,
    parseDateToMillis,
} from './timeSeriesUtils';

const DAY_IN_MS = 24 * 60 * 60 * 1000;

type Maybe<T> = T | null | undefined;

interface JoinedField {
    normalizedPath: string;
    fieldPath: string;
    field?: Maybe<SchemaFieldSummary>;
    profile?: Maybe<DatasetFieldProfile>;
    metadata?: Record<string, string>;
}

export interface TimestampColumnSummary {
    normalizedPath: string;
    fieldPath: string;
    displayName: string;
    description?: string;
    dataType?: string;
    nullProportion?: number;
    sampleValues: string[];
    metadata?: Record<string, string>;
}

export interface ValueColumnSummary {
    normalizedPath: string;
    fieldPath: string;
    displayName: string;
    description?: string;
    dataType?: string;
    units?: string;
    min?: string | number;
    max?: string | number;
    mean?: string | number;
    stdev?: string | number;
    nullProportion?: number;
    sampleValues: string[];
    metadata?: Record<string, string>;
}

export interface TimeCoverageSummary {
    startMs: number;
    endMs: number;
    durationMs: number;
}

export interface SamplingIntervalSummary {
    label: string;
    details?: string;
    ms?: number;
    source: 'configured' | 'derived';
}

export interface TimeSeriesMetadata {
    loadingSchema: boolean;
    datasetName?: string | null;
    rowCount?: number | null;
    timeColumn?: TimestampColumnSummary;
    valueColumns: ValueColumnSummary[];
    metadataEntries: TimeseriesCustomConfigEntry[];
    coverage?: TimeCoverageSummary;
    samplingInterval?: SamplingIntervalSummary;
    timezone?: string;
    hasProfile: boolean;
}

const extractSchemaFields = (schemaMetadata: any): SchemaFieldSummary[] => {
    if (!schemaMetadata) {
        return [];
    }
    const metadataArray = Array.isArray(schemaMetadata) ? schemaMetadata : [schemaMetadata];
    return metadataArray
        .flatMap((metadata) => metadata?.fields || [])
        .filter((field) => !!field) as SchemaFieldSummary[];
};

const toDisplayName = (field: JoinedField): string => {
    const metadataLabel = field.metadata?.label || field.metadata?.display_name;
    if (metadataLabel) {
        return metadataLabel;
    }
    if (field.field?.label) {
        return field.field.label;
    }
    if (field.field?.fieldPath) {
        return field.field.fieldPath;
    }
    if (field.profile?.fieldPath) {
        return field.profile.fieldPath;
    }
    return field.normalizedPath;
};

const toDataType = (field: JoinedField): string | undefined => {
    if (field.metadata?.datatype) {
        return field.metadata.datatype;
    }
    if (typeof field.field?.type === 'string') {
        const lower = field.field.type.toLowerCase();
        return lower.charAt(0).toUpperCase() + lower.slice(1);
    }
    if (field.field?.nativeDataType) {
        return field.field.nativeDataType;
    }
    return undefined;
};

const toDescription = (field: JoinedField): string | undefined => {
    return field.metadata?.description || field.field?.description;
};

const joinFields = (
    schemaFields: SchemaFieldSummary[],
    profiles: DatasetFieldProfile[],
    columnMetadata: Record<string, Record<string, string>>,
): JoinedField[] => {
    const profileMap = new Map<string, DatasetFieldProfile>();
    profiles.forEach((profile) => {
        const normalized = normalizeFieldPath(profile.fieldPath);
        if (!normalized) {
            return;
        }
        if (!profileMap.has(normalized)) {
            profileMap.set(normalized, profile);
        }
    });

    const joined: JoinedField[] = [];
    schemaFields.forEach((schemaField) => {
        const normalized = normalizeFieldPath(schemaField.fieldPath);
        if (!normalized) {
            return;
        }
        joined.push({
            normalizedPath: normalized,
            fieldPath: schemaField.fieldPath || normalized,
            field: schemaField,
            profile: profileMap.get(normalized),
            metadata: columnMetadata[normalized],
        });
    });

    profileMap.forEach((profile, normalized) => {
        if (joined.some((item) => item.normalizedPath === normalized)) {
            return;
        }
        joined.push({
            normalizedPath,
            fieldPath: profile.fieldPath || normalized,
            profile,
            metadata: columnMetadata[normalized],
        });
    });

    return joined;
};

const hasTimeFriendlySchemaType = (field: JoinedField): boolean => {
    const candidateType = typeof field.field?.type === 'string' ? field.field.type.toLowerCase() : undefined;
    if (candidateType && (candidateType.includes('time') || candidateType.includes('date'))) {
        return true;
    }
    const native = field.field?.nativeDataType?.toLowerCase();
    if (native && (native.includes('time') || native.includes('date'))) {
        return true;
    }
    const path = field.field?.fieldPath?.toLowerCase();
    if (path && (path.includes('time') || path.includes('date'))) {
        return true;
    }
    const label = field.field?.label?.toLowerCase();
    if (label && (label.includes('time') || label.includes('date'))) {
        return true;
    }
    const metadataRole = field.metadata?.role?.toLowerCase?.();
    if (metadataRole && (metadataRole.includes('time') || metadataRole.includes('timestamp'))) {
        return true;
    }
    return false;
};

const pickTimeField = (fields: JoinedField[], explicitColumn?: string): JoinedField | undefined => {
    if (!fields.length) {
        return undefined;
    }
    if (explicitColumn) {
        const normalized = normalizeFieldPath(explicitColumn);
        const explicitMatch = fields.find((field) => field.normalizedPath === normalized);
        if (explicitMatch) {
            return explicitMatch;
        }
    }
    const schemaMatches = fields.filter((field) => hasTimeFriendlySchemaType(field));
    if (schemaMatches.length > 0) {
        const withCoverage = schemaMatches.filter((field) => field.profile && isParsableDate(field.profile.min || field.profile.max));
        if (withCoverage.length > 0) {
            return withCoverage.sort((a, b) => {
                const coverageA = deriveCoverage(a.profile);
                const coverageB = deriveCoverage(b.profile);
                const durationA = coverageA?.durationMs || 0;
                const durationB = coverageB?.durationMs || 0;
                return durationB - durationA;
            })[0];
        }
        return schemaMatches[0];
    }
    const profileMatches = fields.filter((field) => field.profile && (isParsableDate(field.profile?.min) || isParsableDate(field.profile?.max)));
    if (profileMatches.length > 0) {
        return profileMatches.sort((a, b) => {
            const coverageA = deriveCoverage(a.profile);
            const coverageB = deriveCoverage(b.profile);
            const durationA = coverageA?.durationMs || 0;
            const durationB = coverageB?.durationMs || 0;
            return durationB - durationA;
        })[0];
    }
    return undefined;
};

const numericNativeTypeRegex = /(int|double|float|number|decimal|numeric|real|double precision)/;

const isValueField = (field: JoinedField, timeFieldPath?: string): boolean => {
    if (!field.profile && !field.field) {
        return false;
    }
    if (timeFieldPath && field.normalizedPath === timeFieldPath) {
        return false;
    }
    const metadataRole = field.metadata?.role?.toLowerCase?.();
    if (metadataRole && (metadataRole.includes('value') || metadataRole.includes('measurement') || metadataRole.includes('reading'))) {
        return true;
    }
    if (field.field?.type && typeof field.field.type === 'string' && field.field.type.toLowerCase() === 'number') {
        return true;
    }
    const native = field.field?.nativeDataType?.toLowerCase();
    if (native && numericNativeTypeRegex.test(native)) {
        return true;
    }
    return hasNumericStats(field.profile);
};

const deriveCoverage = (profile?: Maybe<DatasetFieldProfile>): TimeCoverageSummary | undefined => {
    if (!profile) {
        return undefined;
    }
    let start = parseDateToMillis(profile.min);
    let end = parseDateToMillis(profile.max);

    const samples = (profile.sampleValues || [])
        .map((sample) => parseDateToMillis(sample || undefined))
        .filter((value): value is number => value !== null)
        .sort((a, b) => a - b);

    if ((start === null || start === undefined) && samples.length > 0) {
        start = samples[0];
    }
    if ((end === null || end === undefined) && samples.length > 0) {
        end = samples[samples.length - 1];
    }

    if (start === null || start === undefined || end === null || end === undefined) {
        return undefined;
    }

    if (end < start) {
        const tmp = end;
        end = start;
        start = tmp;
    }

    return {
        startMs: start,
        endMs: end,
        durationMs: Math.max(end - start, 0),
    };
};

const deriveSamplingInterval = (
    coverage: TimeCoverageSummary | undefined,
    profile: Maybe<DatasetProfileSummary>,
    configuredFrequency?: string,
): SamplingIntervalSummary | undefined => {
    if (configuredFrequency) {
        return {
            label: configuredFrequency,
            source: 'configured',
        };
    }
    if (!coverage || !profile?.rowCount || profile.rowCount < 2) {
        return undefined;
    }
    const averageInterval = coverage.durationMs / (profile.rowCount - 1);
    if (!Number.isFinite(averageInterval) || averageInterval <= 0) {
        return undefined;
    }
    const ms = Math.round(averageInterval);
    const label = formatDuration(ms);
    if (!Number.isFinite(ms) || ms <= 0) {
        return undefined;
    }
    const samplesPerDay = DAY_IN_MS / ms;
    const details = Number.isFinite(samplesPerDay)
        ? `≈ ${Math.round(samplesPerDay * 10) / 10} samples/day`
        : undefined;
    return {
        label,
        details,
        ms,
        source: 'derived',
    };
};

const toSampleValues = (profile?: Maybe<DatasetFieldProfile>): string[] => {
    if (!profile?.sampleValues) {
        return [];
    }
    return profile.sampleValues
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
        .slice(0, 8);
};

const toUnits = (metadata?: Record<string, string>): string | undefined => {
    if (!metadata) {
        return undefined;
    }
    return metadata.units || metadata.unit || metadata.measure || metadata.measurement_unit;
};

const createTimestampSummary = (field: JoinedField): TimestampColumnSummary => ({
    normalizedPath: field.normalizedPath,
    fieldPath: field.fieldPath,
    displayName: toDisplayName(field),
    description: toDescription(field),
    dataType: toDataType(field),
    nullProportion: field.profile?.nullProportion ?? undefined,
    sampleValues: toSampleValues(field.profile),
    metadata: field.metadata,
});

const createValueSummary = (field: JoinedField): ValueColumnSummary => ({
    normalizedPath: field.normalizedPath,
    fieldPath: field.fieldPath,
    displayName: toDisplayName(field),
    description: toDescription(field),
    dataType: toDataType(field),
    units: toUnits(field.metadata),
    min: field.profile?.min ?? undefined,
    max: field.profile?.max ?? undefined,
    mean: field.profile?.mean ?? undefined,
    stdev: field.profile?.stdev ?? undefined,
    nullProportion: field.profile?.nullProportion ?? undefined,
    sampleValues: toSampleValues(field.profile),
    metadata: field.metadata,
});

export const useTimeSeriesMetadata = (): TimeSeriesMetadata => {
    const baseEntity = useBaseEntity<GetDatasetQuery>();
    const { entityWithSchema, loading: schemaLoading } = useGetEntityWithSchema();

    const datasetWithSchema = entityWithSchema as any;
    const dataset = datasetWithSchema || baseEntity?.dataset;

    const latestProfile = useMemo(() => getLatestProfileFromDataset(baseEntity?.dataset as any), [baseEntity]);

    const fieldProfiles = useMemo(() => {
        if (!latestProfile?.fieldProfiles) {
            return [] as DatasetFieldProfile[];
        }
        return (latestProfile.fieldProfiles.filter((profile) => profile) as DatasetFieldProfile[]).map((profile) => profile);
    }, [latestProfile]);

    const schemaFields = useMemo(() => extractSchemaFields(dataset?.schemaMetadata), [dataset?.schemaMetadata]);

    const config = useMemo(
        () => extractTimeseriesCustomConfig(dataset?.properties?.customProperties as any),
        [dataset?.properties?.customProperties],
    );

    const joinedFields = useMemo(
        () => joinFields(schemaFields, fieldProfiles, config.columnMetadata),
        [schemaFields, fieldProfiles, config.columnMetadata],
    );

    const timeField = useMemo(
        () => pickTimeField(joinedFields, config.timestampColumn),
        [joinedFields, config.timestampColumn],
    );

    const valueFields = useMemo(
        () =>
            joinedFields
                .filter((field) => isValueField(field, timeField?.normalizedPath))
                .sort((a, b) => toDisplayName(a).localeCompare(toDisplayName(b))),
        [joinedFields, timeField?.normalizedPath],
    );

    const coverage = useMemo(() => deriveCoverage(timeField?.profile), [timeField?.profile]);

    const samplingInterval = useMemo(
        () => deriveSamplingInterval(coverage, latestProfile, config.frequency),
        [coverage, latestProfile, config.frequency],
    );

    return {
        loadingSchema: schemaLoading,
        datasetName: dataset?.properties?.name || dataset?.name,
        rowCount: latestProfile?.rowCount ?? null,
        timeColumn: timeField ? createTimestampSummary(timeField) : undefined,
        valueColumns: valueFields.map((field) => createValueSummary(field)),
        metadataEntries: config.metadataEntries,
        coverage,
        samplingInterval,
        timezone: config.timezone,
        hasProfile: Boolean(latestProfile),
    };
};
