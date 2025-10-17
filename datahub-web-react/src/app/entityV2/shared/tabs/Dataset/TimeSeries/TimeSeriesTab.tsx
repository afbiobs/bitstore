import { Card, Descriptions, Empty, Skeleton, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import React, { useMemo } from 'react';
import styled from 'styled-components';

import { formatDuration } from '@app/shared/formatDuration';
import { formatNumberWithoutAbbreviation } from '@app/shared/formatNumber';
import { toLocalDateTimeString } from '@app/shared/time/timeUtils';

import { useTimeSeriesMetadata } from './useTimeSeriesMetadata';
import type { SamplingIntervalSummary, TimeCoverageSummary, ValueColumnSummary } from './useTimeSeriesMetadata';

const Container = styled.div`
    display: flex;
    flex-direction: column;
    gap: 24px;
    width: 100%;
`;

const SummaryGrid = styled.div`
    display: grid;
    gap: 16px;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
`;

const DetailGrid = styled.div`
    display: grid;
    gap: 16px;
    grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
`;

const SampleValues = styled.div`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
`;

const CardBody = styled(Card)`
    height: 100%;
`;

const ValueTableCard = styled(Card)`
    height: 100%;

    .ant-card-body {
        padding: 0;
    }
`;

const TableHeader = styled.div`
    padding: 16px 16px 0;
`;

const TablePadding = styled.div`
    padding: 0 16px 16px;
`;

const FieldLabel = styled.span`
    font-weight: 600;
    margin-right: 4px;
`;

interface ValueColumnRow {
    key: string;
    column: ValueColumnSummary;
}

const formatStatValue = (value: string | number | undefined): string => {
    if (value === undefined || value === null || value === '') {
        return '—';
    }
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            return '—';
        }
        if (Math.abs(value) >= 1000) {
            return formatNumberWithoutAbbreviation(value);
        }
        return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return '—';
    }
    const numeric = Number(trimmed);
    if (!Number.isNaN(numeric)) {
        if (Math.abs(numeric) >= 1000) {
            return formatNumberWithoutAbbreviation(numeric);
        }
        return numeric.toLocaleString(undefined, { maximumFractionDigits: 4 });
    }
    return trimmed;
};

const columns: ColumnsType<ValueColumnRow> = [
    {
        title: 'Column',
        key: 'column',
        dataIndex: 'column',
        render: (_value, row) => (
            <div>
                <Typography.Text strong>{row.column.displayName}</Typography.Text>
                {row.column.units ? (
                    <Tag color="geekblue" style={{ marginLeft: 8 }}>
                        {row.column.units}
                    </Tag>
                ) : null}
                {row.column.dataType ? (
                    <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
                        {row.column.dataType}
                    </Typography.Text>
                ) : null}
                {row.column.description ? (
                    <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                        {row.column.description}
                    </Typography.Paragraph>
                ) : null}
            </div>
        ),
    },
    {
        title: 'Min',
        key: 'min',
        dataIndex: ['column', 'min'],
        align: 'right',
        render: (value: string | number | undefined) => formatStatValue(value),
        responsive: ['md'],
    },
    {
        title: 'Max',
        key: 'max',
        dataIndex: ['column', 'max'],
        align: 'right',
        render: (value: string | number | undefined) => formatStatValue(value),
        responsive: ['md'],
    },
    {
        title: 'Mean',
        key: 'mean',
        dataIndex: ['column', 'mean'],
        align: 'right',
        render: (value: string | number | undefined) => formatStatValue(value),
        responsive: ['lg'],
    },
    {
        title: 'Std Dev',
        key: 'stdev',
        dataIndex: ['column', 'stdev'],
        align: 'right',
        render: (value: string | number | undefined) => formatStatValue(value),
        responsive: ['lg'],
    },
    {
        title: 'Null %',
        key: 'nullPercent',
        dataIndex: ['column', 'nullProportion'],
        align: 'right',
        render: (value: number | undefined) => (value !== undefined ? `${(value * 100).toFixed(1)}%` : '—'),
        responsive: ['sm'],
    },
    {
        title: 'Sample values',
        key: 'samples',
        align: 'left',
        render: (_value, row) =>
            row.column.sampleValues.length ? (
                <SampleValues>
                    {row.column.sampleValues.map((sample) => (
                        <Tag key={`${row.column.normalizedPath}-${sample}`}>{sample}</Tag>
                    ))}
                </SampleValues>
            ) : (
                '—'
            ),
        responsive: ['xl'],
    },
];

const renderCoverage = (coverage?: TimeCoverageSummary) => {
    if (!coverage) {
        return (
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                We could not determine a time range yet. Generate a dataset profile or annotate your timestamp column.
            </Typography.Paragraph>
        );
    }
    return (
        <>
            <Typography.Paragraph style={{ marginBottom: 0 }}>
                <FieldLabel>Earliest record:</FieldLabel>
                {toLocalDateTimeString(coverage.startMs)}
            </Typography.Paragraph>
            <Typography.Paragraph style={{ marginBottom: 0 }}>
                <FieldLabel>Latest record:</FieldLabel>
                {toLocalDateTimeString(coverage.endMs)}
            </Typography.Paragraph>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                Duration {formatDuration(coverage.durationMs)}
            </Typography.Paragraph>
        </>
    );
};

const renderTimestampCoverage = (coverage?: TimeCoverageSummary) => {
    if (!coverage) {
        return (
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                We could not compute timestamp coverage yet. Trigger profiling or confirm which column stores event times.
            </Typography.Paragraph>
        );
    }
    return (
        <>
            <Typography.Paragraph style={{ marginBottom: 0 }}>
                <FieldLabel>Coverage start:</FieldLabel>
                {toLocalDateTimeString(coverage.startMs)}
            </Typography.Paragraph>
            <Typography.Paragraph style={{ marginBottom: 0 }}>
                <FieldLabel>Coverage end:</FieldLabel>
                {toLocalDateTimeString(coverage.endMs)}
            </Typography.Paragraph>
        </>
    );
};

const renderSamplingInterval = (samplingInterval?: SamplingIntervalSummary) => {
    if (!samplingInterval) {
        return null;
    }
    return (
        <Typography.Paragraph style={{ marginBottom: 0 }}>
            <FieldLabel>Sampling interval:</FieldLabel>
            {samplingInterval.label}
            {samplingInterval.details ? (
                <Typography.Text type="secondary"> {samplingInterval.details}</Typography.Text>
            ) : null}
        </Typography.Paragraph>
    );
};

export const TimeSeriesTab: React.FC = () => {
    const {
        loadingSchema,
        rowCount,
        timeColumn,
        valueColumns,
        metadataEntries,
        coverage,
        samplingInterval,
        timezone,
        hasProfile,
    } = useTimeSeriesMetadata();

    const tableData = useMemo(
        () =>
            valueColumns.map<ValueColumnRow>((column) => ({
                key: column.normalizedPath || column.fieldPath || column.displayName,
                column,
            })),
        [valueColumns],
    );

    if (loadingSchema && !timeColumn && !valueColumns.length) {
        return <Skeleton active paragraph={{ rows: 6 }} />;
    }

    return (
        <Container>
            <SummaryGrid>
                <CardBody>
                    <Typography.Title level={4}>Time coverage</Typography.Title>
                    {renderCoverage(coverage)}
                    <Typography.Paragraph style={{ margin: '16px 0 0' }}>
                        <FieldLabel>Records captured:</FieldLabel>
                        {rowCount ? formatNumberWithoutAbbreviation(rowCount) : hasProfile ? 'Unknown' : 'No profile yet'}
                    </Typography.Paragraph>
                    {renderSamplingInterval(samplingInterval)}
                    {timezone ? (
                        <Typography.Paragraph style={{ marginBottom: 0 }}>
                            <FieldLabel>Time zone:</FieldLabel>
                            {timezone}
                        </Typography.Paragraph>
                    ) : null}
                </CardBody>
                <CardBody>
                    <Typography.Title level={4}>Context</Typography.Title>
                    {metadataEntries.length ? (
                        <Descriptions column={1} size="small">
                            {metadataEntries.map((entry) => (
                                <Descriptions.Item key={`${entry.label}-${entry.value}`} label={entry.label}>
                                    {entry.value}
                                </Descriptions.Item>
                            ))}
                        </Descriptions>
                    ) : (
                        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                            Capture sensor, location, or unit details by adding <code>timeseries.*</code> custom properties to this dataset.
                        </Typography.Paragraph>
                    )}
                </CardBody>
            </SummaryGrid>
            <DetailGrid>
                <CardBody>
                    <Typography.Title level={5}>Primary timestamp column</Typography.Title>
                    {timeColumn ? (
                        <>
                            <Typography.Paragraph style={{ marginBottom: 0 }}>
                                <FieldLabel>Column:</FieldLabel>
                                {timeColumn.displayName}
                                {timeColumn.dataType ? (
                                    <Typography.Text type="secondary"> ({timeColumn.dataType})</Typography.Text>
                                ) : null}
                            </Typography.Paragraph>
                            {timeColumn.description ? (
                                <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                                    {timeColumn.description}
                                </Typography.Paragraph>
                            ) : null}
                            {timeColumn.nullProportion !== undefined ? (
                                <Typography.Paragraph style={{ marginBottom: 0 }}>
                                    <FieldLabel>Null values:</FieldLabel>
                                    {(timeColumn.nullProportion * 100).toFixed(1)}%
                                </Typography.Paragraph>
                            ) : null}
                            {renderTimestampCoverage(coverage)}
                            {timeColumn.sampleValues.length ? (
                                <>
                                    <Typography.Paragraph style={{ marginBottom: 4 }}>
                                        <FieldLabel>Sample values</FieldLabel>
                                    </Typography.Paragraph>
                                    <SampleValues>
                                        {timeColumn.sampleValues.map((sample) => (
                                            <Tag key={`${timeColumn.normalizedPath}-${sample}`}>{sample}</Tag>
                                        ))}
                                    </SampleValues>
                                </>
                            ) : null}
                        </>
                    ) : (
                        <Empty
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                            description="We could not identify a timestamp column. Add a `timeseries.timestamp_column` custom property or generate profiling statistics."
                        />
                    )}
                </CardBody>
                <ValueTableCard>
                    <TableHeader>
                        <Typography.Title level={5} style={{ marginBottom: 0 }}>
                            Value columns
                        </Typography.Title>
                    </TableHeader>
                    {tableData.length ? (
                        <TablePadding>
                            <Table<ValueColumnRow>
                                columns={columns}
                                dataSource={tableData}
                                pagination={false}
                                size="small"
                                rowKey={(row) => row.key}
                                scroll={{ x: true }}
                            />
                        </TablePadding>
                    ) : (
                        <Empty
                            style={{ margin: '24px 0' }}
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                            description="No numeric columns with profiling data were found. Profile this dataset or tag value columns to populate this table."
                        />
                    )}
                </ValueTableCard>
            </DetailGrid>
        </Container>
    );
};

export default TimeSeriesTab;
