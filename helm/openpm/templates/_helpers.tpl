{{/*
Expand the name of the chart.
*/}}
{{- define "openpm.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "openpm.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "openpm.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "openpm.labels" -}}
helm.sh/chart: {{ include "openpm.chart" . }}
{{ include "openpm.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "openpm.selectorLabels" -}}
app.kubernetes.io/name: {{ include "openpm.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create fullname for api
*/}}
{{- define "openpm.api.fullname" -}}
{{- printf "%s-api" (include "openpm.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end }}

{{/*
Create fullname for worker
*/}}
{{- define "openpm.worker.fullname" -}}
{{- printf "%s-worker" (include "openpm.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end }}

{{/*
Create fullname for frontend
*/}}
{{- define "openpm.frontend.fullname" -}}
{{- printf "%s-frontend" (include "openpm.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end }}

{{/*
Create fullname for postgres
*/}}
{{- define "openpm.postgres.fullname" -}}
{{- printf "%s-postgres" (include "openpm.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end }}

{{/*
Create fullname for redis
*/}}
{{- define "openpm.redis.fullname" -}}
{{- printf "%s-redis" (include "openpm.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end }}
