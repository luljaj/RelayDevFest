import React, { memo } from 'react';
import { BaseEdge, EdgeProps, getSmoothStepPath } from 'reactflow';
import { getUserColor } from '../utils/colors';

const DependencyEdge = ({
    id,
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
    const [edgePath] = getSmoothStepPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
    });

    const isNew = data?.isNew;
    const createdBy = data?.createdBy; // userId
    const userColor = createdBy ? getUserColor(createdBy) : null;

    const strokeColor = isNew && userColor
        ? Object.values(userColor)[8]
        : style.stroke || '#94a3b8'; // default slate-400

    return (
        <>
            <BaseEdge
                path={edgePath}
                markerEnd={markerEnd}
                style={{
                    ...style,
                    stroke: strokeColor,
                    strokeWidth: isNew ? 2 : 1,
                    transition: 'stroke 2s ease-out, stroke-width 2s ease-out',
                }}
            />
        </>
    );
};

export default memo(DependencyEdge);
