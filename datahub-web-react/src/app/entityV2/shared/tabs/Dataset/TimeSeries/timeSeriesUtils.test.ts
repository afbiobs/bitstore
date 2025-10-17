import { describe, expect, it } from 'vitest';

import type { GetDatasetQuery } from '@graphql/dataset.generated';

import {
    extractTimeseriesCustomConfig,
    isNumericValue,
    isParsableDate,
    isTimeseriesDataset,
    normalizeFieldPath,
    parseDateToMillis,
} from './timeSeriesUtils';

describe('timeSeriesUtils', () => {
    it('normalizes field paths', () => {
        expect(normalizeFieldPath('`Sensor`.`Temperature`')).toEqual('sensor.temperature');
        expect(normalizeFieldPath('timeStamp')).toEqual('timestamp');
        expect(normalizeFieldPath(undefined)).toEqual('');
    });

    it('detects numeric strings', () => {
        expect(isNumericValue('42')).toBe(true);
        expect(isNumericValue('-12.5')).toBe(true);
        expect(isNumericValue('abc')).toBe(false);
        expect(isNumericValue(undefined)).toBe(false);
    });

    it('parses multiple date formats', () => {
        const epochSeconds = parseDateToMillis('1700000000');
        const isoString = parseDateToMillis('2024-01-01T00:00:00Z');
        const yyyymmdd = parseDateToMillis('20240115');

        expect(epochSeconds).toBeCloseTo(1700000000 * 1000, -1);
        expect(isoString).toBeCloseTo(Date.parse('2024-01-01T00:00:00Z'), -1);
        expect(yyyymmdd).toBeCloseTo(Date.parse('2024-01-15T00:00:00Z'), -1);
    });

    it('checks parseable dates', () => {
        expect(isParsableDate('2024-01-01')).toBe(true);
        expect(isParsableDate('not-a-date')).toBe(false);
    });

    it('extracts timeseries custom config', () => {
        const config = extractTimeseriesCustomConfig([
            { key: 'timeseries.timestamp_column', value: 'collected_at' },
            { key: 'timeseries.sensor_id', value: 'logger-9' },
            { key: 'timeseries.column.temperature.units', value: '°C' },
        ]);

        expect(config.timestampColumn).toEqual('collected_at');
        expect(config.metadataEntries).toEqual([{ label: 'Sensor ID', value: 'logger-9' }]);
        expect(config.columnMetadata.temperature.units).toEqual('°C');
    });

    it('identifies timeseries dataset from profiles', () => {
        const dataset = {
            dataset: {
                properties: {
                    customProperties: [],
                },
                latestFullTableProfile: [
                    {
                        fieldProfiles: [
                            {
                                fieldPath: 'collected_at',
                                min: '2024-05-01T00:00:00Z',
                                max: '2024-05-02T00:00:00Z',
                            },
                            {
                                fieldPath: 'temperature_c',
                                mean: 21.3,
                                max: '25',
                            },
                        ],
                    },
                ],
            },
        } as unknown as GetDatasetQuery;

        expect(isTimeseriesDataset(dataset)).toBe(true);
    });

    it('requires both time and numeric indicators', () => {
        const datasetWithoutTime = {
            dataset: {
                properties: {
                    customProperties: [],
                },
                latestFullTableProfile: [
                    {
                        fieldProfiles: [
                            { fieldPath: 'temperature_c', mean: 22.1 },
                        ],
                    },
                ],
            },
        } as unknown as GetDatasetQuery;

        expect(isTimeseriesDataset(datasetWithoutTime)).toBe(false);
    });
});
