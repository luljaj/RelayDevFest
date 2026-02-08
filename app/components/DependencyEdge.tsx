import React, { memo } from 'react';
import { BaseEdge, EdgeProps, getBezierPath } from 'reactflow';

const DependencyEdge = ({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    style = {},
    markerEnd,
    data,
}: EdgeProps) => {
    const [edgePath] = getBezierPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
    });

    const isNew = data?.isNew;
    const strokeColor = normalizeStroke(style.stroke);
    const baseWidth = typeof style.strokeWidth === 'number' ? style.strokeWidth : 1.2;

    return (
        <>
            <BaseEdge
                path={edgePath}
                markerEnd={markerEnd}
                style={{
                    ...style,
                    stroke: strokeColor,
                    strokeWidth: isNew ? Math.max(2, baseWidth) : baseWidth,
                    strokeDasharray: isNew ? '6 4' : undefined,
                    filter: isNew ? `drop-shadow(0 0 2px ${strokeColor})` : 'none',
                    transition: 'stroke 1.8s ease-out, stroke-width 1.8s ease-out, filter 1.8s ease-out',
                }}
            />
        </>
    );
};

function normalizeStroke(value: unknown): string {
    if (typeof value === 'string') {
        return value;
    }
    return '#a1a1aa';
}

export default memo(DependencyEdge);
