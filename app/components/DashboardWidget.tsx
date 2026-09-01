'use client'

import { Draggable } from '@hello-pangea/dnd'

type Props = {
  id: string
  index: number
  children: React.ReactNode
  title?: string
}

export default function DashboardWidget({ id, index, children, title }: Props) {
  return (
    <Draggable draggableId={id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          className={`transition ${snapshot.isDragging ? 'opacity-90 scale-[1.01] shadow-2xl shadow-indigo-500/10' : ''}`}
        >
          {/* Drag Handle */}
          <div
            {...provided.dragHandleProps}
            className="flex items-center gap-2 mb-3 cursor-grab active:cursor-grabbing group w-fit"
          >
            <div className="flex flex-col gap-0.5 opacity-30 group-hover:opacity-70 transition">
              <div className="flex gap-0.5">
                <div className="w-1 h-1 rounded-full bg-gray-400" />
                <div className="w-1 h-1 rounded-full bg-gray-400" />
              </div>
              <div className="flex gap-0.5">
                <div className="w-1 h-1 rounded-full bg-gray-400" />
                <div className="w-1 h-1 rounded-full bg-gray-400" />
              </div>
              <div className="flex gap-0.5">
                <div className="w-1 h-1 rounded-full bg-gray-400" />
                <div className="w-1 h-1 rounded-full bg-gray-400" />
              </div>
            </div>
            {title && (
              <span className="text-gray-500 text-xs uppercase tracking-widest group-hover:text-gray-400 transition">
                {title}
              </span>
            )}
          </div>

          {children}
        </div>
      )}
    </Draggable>
  )
}