interface PageProps {
  title: string
  description?: string
  action?: React.ReactNode
  children: React.ReactNode
}

export function Page({ title, description, action, children }: PageProps) {
  return (
    <div className="p-6">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-base font-semibold text-[#F9FAFB]">{title}</h1>
          {description && <p className="text-xs text-[#6B7280] mt-0.5">{description}</p>}
        </div>
        {action && <div className="flex-shrink-0 ml-4">{action}</div>}
      </div>
      {children}
    </div>
  )
}
