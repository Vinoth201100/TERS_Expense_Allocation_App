export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      aa_branch_codes: {
        Row: {
          approved_auditor_id: string
          branch_code: string
          created_at: string
          created_by: string | null
          id: string
        }
        Insert: {
          approved_auditor_id: string
          branch_code: string
          created_at?: string
          created_by?: string | null
          id?: string
        }
        Update: {
          approved_auditor_id?: string
          branch_code?: string
          created_at?: string
          created_by?: string | null
          id?: string
        }
        Relationships: []
      }
      admin_audit_log: {
        Row: {
          action: string
          actor_id: string
          created_at: string
          id: string
          metadata: Json
          reason: string
          target_id: string | null
          target_type: string
        }
        Insert: {
          action: string
          actor_id: string
          created_at?: string
          id?: string
          metadata?: Json
          reason: string
          target_id?: string | null
          target_type: string
        }
        Update: {
          action?: string
          actor_id?: string
          created_at?: string
          id?: string
          metadata?: Json
          reason?: string
          target_id?: string | null
          target_type?: string
        }
        Relationships: []
      }
      attendance: {
        Row: {
          benchmark: number
          created_at: string
          date: string
          id: string
          leave_type: string | null
          present: boolean
          user_id: string
        }
        Insert: {
          benchmark?: number
          created_at?: string
          date?: string
          id?: string
          leave_type?: string | null
          present?: boolean
          user_id: string
        }
        Update: {
          benchmark?: number
          created_at?: string
          date?: string
          id?: string
          leave_type?: string | null
          present?: boolean
          user_id?: string
        }
        Relationships: []
      }
      auditor_benchmarks: {
        Row: {
          auditor_id: string
          created_at: string
          default_count: number
          id: string
          kind: Database["public"]["Enums"]["benchmark_kind"]
          team_lead_id: string
          updated_at: string
        }
        Insert: {
          auditor_id: string
          created_at?: string
          default_count?: number
          id?: string
          kind: Database["public"]["Enums"]["benchmark_kind"]
          team_lead_id: string
          updated_at?: string
        }
        Update: {
          auditor_id?: string
          created_at?: string
          default_count?: number
          id?: string
          kind?: Database["public"]["Enums"]["benchmark_kind"]
          team_lead_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      auditor_benchmarks_daily: {
        Row: {
          auditor_id: string
          count: number
          created_at: string
          date: string
          id: string
          kind: Database["public"]["Enums"]["benchmark_kind"]
          team_lead_id: string
          updated_at: string
        }
        Insert: {
          auditor_id: string
          count: number
          created_at?: string
          date?: string
          id?: string
          kind: Database["public"]["Enums"]["benchmark_kind"]
          team_lead_id: string
          updated_at?: string
        }
        Update: {
          auditor_id?: string
          count?: number
          created_at?: string
          date?: string
          id?: string
          kind?: Database["public"]["Enums"]["benchmark_kind"]
          team_lead_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      auditor_team_leads: {
        Row: {
          auditor_id: string
          created_at: string
          created_by: string | null
          id: string
          team_lead_id: string
          updated_at: string
        }
        Insert: {
          auditor_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          team_lead_id: string
          updated_at?: string
        }
        Update: {
          auditor_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          team_lead_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      batch_delete_requests: {
        Row: {
          assigned_team_lead: string | null
          batch_id: string
          created_at: string
          decision_reason: string | null
          id: string
          reason: string
          requested_at: string
          requested_by: string
          reviewed_at: string | null
          reviewer_id: string | null
          status: Database["public"]["Enums"]["delete_request_status"]
          updated_at: string
        }
        Insert: {
          assigned_team_lead?: string | null
          batch_id: string
          created_at?: string
          decision_reason?: string | null
          id?: string
          reason: string
          requested_at?: string
          requested_by: string
          reviewed_at?: string | null
          reviewer_id?: string | null
          status?: Database["public"]["Enums"]["delete_request_status"]
          updated_at?: string
        }
        Update: {
          assigned_team_lead?: string | null
          batch_id?: string
          created_at?: string
          decision_reason?: string | null
          id?: string
          reason?: string
          requested_at?: string
          requested_by?: string
          reviewed_at?: string | null
          reviewer_id?: string | null
          status?: Database["public"]["Enums"]["delete_request_status"]
          updated_at?: string
        }
        Relationships: []
      }
      batches: {
        Row: {
          allocation_mode: string
          created_at: string
          filename: string
          id: string
          sharepoint_url: string | null
          status: string
          total_groups: number
          total_lines: number
          upload_date: string
          uploaded_by: string
        }
        Insert: {
          allocation_mode?: string
          created_at?: string
          filename: string
          id?: string
          sharepoint_url?: string | null
          status?: string
          total_groups?: number
          total_lines?: number
          upload_date?: string
          uploaded_by: string
        }
        Update: {
          allocation_mode?: string
          created_at?: string
          filename?: string
          id?: string
          sharepoint_url?: string | null
          status?: string
          total_groups?: number
          total_lines?: number
          upload_date?: string
          uploaded_by?: string
        }
        Relationships: []
      }
      ea_batches: {
        Row: {
          allocation_mode: string
          created_at: string
          filename: string
          id: string
          sharepoint_url: string | null
          status: string
          total_branches: number
          total_lines: number
          upload_date: string
          uploaded_by: string
        }
        Insert: {
          allocation_mode?: string
          created_at?: string
          filename: string
          id?: string
          sharepoint_url?: string | null
          status?: string
          total_branches?: number
          total_lines?: number
          upload_date?: string
          uploaded_by: string
        }
        Update: {
          allocation_mode?: string
          created_at?: string
          filename?: string
          id?: string
          sharepoint_url?: string | null
          status?: string
          total_branches?: number
          total_lines?: number
          upload_date?: string
          uploaded_by?: string
        }
        Relationships: []
      }
      ea_lines: {
        Row: {
          allocated_date: string | null
          amount: number | null
          approved_by: string | null
          assigned_ea: string | null
          batch_id: string
          branch: string | null
          category: string | null
          created_at: string
          currency: string | null
          date_submitted: string | null
          decided_at: string | null
          decision_comment: string | null
          employee: string | null
          escalated_comment: string | null
          escalated_date: string | null
          exception_hold_comment: string | null
          expense_number: string | null
          final_decision: string | null
          followup_1_date: string | null
          followup_2_date: string | null
          followup_3_date: string | null
          id: string
          is_resubmitted: boolean
          merchant: string | null
          previous_status: string | null
          project: string | null
          raw_data: Json
          rejected_reason: string | null
          status: Database["public"]["Enums"]["ea_daily_status"]
          updated_at: string
          user_id_field: string | null
        }
        Insert: {
          allocated_date?: string | null
          amount?: number | null
          approved_by?: string | null
          assigned_ea?: string | null
          batch_id: string
          branch?: string | null
          category?: string | null
          created_at?: string
          currency?: string | null
          date_submitted?: string | null
          decided_at?: string | null
          decision_comment?: string | null
          employee?: string | null
          escalated_comment?: string | null
          escalated_date?: string | null
          exception_hold_comment?: string | null
          expense_number?: string | null
          final_decision?: string | null
          followup_1_date?: string | null
          followup_2_date?: string | null
          followup_3_date?: string | null
          id?: string
          is_resubmitted?: boolean
          merchant?: string | null
          previous_status?: string | null
          project?: string | null
          raw_data?: Json
          rejected_reason?: string | null
          status?: Database["public"]["Enums"]["ea_daily_status"]
          updated_at?: string
          user_id_field?: string | null
        }
        Update: {
          allocated_date?: string | null
          amount?: number | null
          approved_by?: string | null
          assigned_ea?: string | null
          batch_id?: string
          branch?: string | null
          category?: string | null
          created_at?: string
          currency?: string | null
          date_submitted?: string | null
          decided_at?: string | null
          decision_comment?: string | null
          employee?: string | null
          escalated_comment?: string | null
          escalated_date?: string | null
          exception_hold_comment?: string | null
          expense_number?: string | null
          final_decision?: string | null
          followup_1_date?: string | null
          followup_2_date?: string | null
          followup_3_date?: string | null
          id?: string
          is_resubmitted?: boolean
          merchant?: string | null
          previous_status?: string | null
          project?: string | null
          raw_data?: Json
          rejected_reason?: string | null
          status?: Database["public"]["Enums"]["ea_daily_status"]
          updated_at?: string
          user_id_field?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ea_lines_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "ea_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      issue_feedback: {
        Row: {
          author_id: string
          author_role: Database["public"]["Enums"]["app_role"]
          comment: string
          created_at: string
          id: string
          line_id: string
        }
        Insert: {
          author_id: string
          author_role: Database["public"]["Enums"]["app_role"]
          comment: string
          created_at?: string
          id?: string
          line_id: string
        }
        Update: {
          author_id?: string
          author_role?: Database["public"]["Enums"]["app_role"]
          comment?: string
          created_at?: string
          id?: string
          line_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "issue_feedback_line_id_fkey"
            columns: ["line_id"]
            isOneToOne: false
            referencedRelation: "lines"
            referencedColumns: ["id"]
          },
        ]
      }
      leads_feedback_history: {
        Row: {
          agrees: boolean | null
          author_id: string
          created_at: string
          feedback: string | null
          id: string
          line_id: string
        }
        Insert: {
          agrees?: boolean | null
          author_id: string
          created_at?: string
          feedback?: string | null
          id?: string
          line_id: string
        }
        Update: {
          agrees?: boolean | null
          author_id?: string
          created_at?: string
          feedback?: string | null
          id?: string
          line_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_feedback_history_line_id_fkey"
            columns: ["line_id"]
            isOneToOne: false
            referencedRelation: "lines"
            referencedColumns: ["id"]
          },
        ]
      }
      line_attachments: {
        Row: {
          created_at: string
          filename: string
          id: string
          line_id: string
          mime_type: string | null
          size_bytes: number | null
          storage_path: string
          uploaded_by: string
        }
        Insert: {
          created_at?: string
          filename: string
          id?: string
          line_id: string
          mime_type?: string | null
          size_bytes?: number | null
          storage_path: string
          uploaded_by: string
        }
        Update: {
          created_at?: string
          filename?: string
          id?: string
          line_id?: string
          mime_type?: string | null
          size_bytes?: number | null
          storage_path?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "line_attachments_line_id_fkey"
            columns: ["line_id"]
            isOneToOne: false
            referencedRelation: "lines"
            referencedColumns: ["id"]
          },
        ]
      }
      lines: {
        Row: {
          aa_allocated_at: string | null
          aa_assigned_to: string | null
          aa_comment: string | null
          aa_decision_at: string | null
          aa_decision_by: string | null
          aa_published_by: string | null
          aa_review_agree: boolean | null
          aa_review_comment: string | null
          aa_status: Database["public"]["Enums"]["aa_status"] | null
          allocated_date: string | null
          amount: number | null
          approved_by: string | null
          assigned_to: string | null
          audit_status: string
          batch_id: string
          branch: string | null
          category: string | null
          created_at: string
          currency: string | null
          date_submitted: string | null
          employee: string | null
          expense_number: string | null
          group_key: string
          id: string
          leads_agrees: boolean | null
          leads_feedback: string | null
          leads_feedback_at: string | null
          leads_feedback_by: string | null
          merchant: string | null
          project: string | null
          published_at: string | null
          published_by: string | null
          qc_category: string | null
          qc_comment: string | null
          qc_completed_at: string | null
          qc_qa_checks: string | null
          qc_type_of_issue: string | null
          raw_data: Json
          status: Database["public"]["Enums"]["line_status"]
          updated_at: string
          user_id_field: string | null
          user_location: string | null
        }
        Insert: {
          aa_allocated_at?: string | null
          aa_assigned_to?: string | null
          aa_comment?: string | null
          aa_decision_at?: string | null
          aa_decision_by?: string | null
          aa_published_by?: string | null
          aa_review_agree?: boolean | null
          aa_review_comment?: string | null
          aa_status?: Database["public"]["Enums"]["aa_status"] | null
          allocated_date?: string | null
          amount?: number | null
          approved_by?: string | null
          assigned_to?: string | null
          audit_status?: string
          batch_id: string
          branch?: string | null
          category?: string | null
          created_at?: string
          currency?: string | null
          date_submitted?: string | null
          employee?: string | null
          expense_number?: string | null
          group_key: string
          id?: string
          leads_agrees?: boolean | null
          leads_feedback?: string | null
          leads_feedback_at?: string | null
          leads_feedback_by?: string | null
          merchant?: string | null
          project?: string | null
          published_at?: string | null
          published_by?: string | null
          qc_category?: string | null
          qc_comment?: string | null
          qc_completed_at?: string | null
          qc_qa_checks?: string | null
          qc_type_of_issue?: string | null
          raw_data?: Json
          status?: Database["public"]["Enums"]["line_status"]
          updated_at?: string
          user_id_field?: string | null
          user_location?: string | null
        }
        Update: {
          aa_allocated_at?: string | null
          aa_assigned_to?: string | null
          aa_comment?: string | null
          aa_decision_at?: string | null
          aa_decision_by?: string | null
          aa_published_by?: string | null
          aa_review_agree?: boolean | null
          aa_review_comment?: string | null
          aa_status?: Database["public"]["Enums"]["aa_status"] | null
          allocated_date?: string | null
          amount?: number | null
          approved_by?: string | null
          assigned_to?: string | null
          audit_status?: string
          batch_id?: string
          branch?: string | null
          category?: string | null
          created_at?: string
          currency?: string | null
          date_submitted?: string | null
          employee?: string | null
          expense_number?: string | null
          group_key?: string
          id?: string
          leads_agrees?: boolean | null
          leads_feedback?: string | null
          leads_feedback_at?: string | null
          leads_feedback_by?: string | null
          merchant?: string | null
          project?: string | null
          published_at?: string | null
          published_by?: string | null
          qc_category?: string | null
          qc_comment?: string | null
          qc_completed_at?: string | null
          qc_qa_checks?: string | null
          qc_type_of_issue?: string | null
          raw_data?: Json
          status?: Database["public"]["Enums"]["line_status"]
          updated_at?: string
          user_id_field?: string | null
          user_location?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lines_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_more_lines_ea: {
        Args: { _auditor: string; _count: number }
        Returns: number
      }
      add_more_lines_qa: {
        Args: { _auditor: string; _count: number }
        Returns: number
      }
      admin_delete_batch: {
        Args: { _batch_id: string; _reason: string }
        Returns: number
      }
      admin_delete_line: {
        Args: { _line_id: string; _reason: string }
        Returns: undefined
      }
      admin_force_unlock_line: {
        Args: { _line_id: string; _reason: string }
        Returns: undefined
      }
      admin_log_action: {
        Args: {
          _action: string
          _metadata?: Json
          _reason: string
          _target_id: string
          _target_type: string
        }
        Returns: undefined
      }
      admin_reallocate_batch: {
        Args: { _batch_id: string; _reason: string; _to: string }
        Returns: number
      }
      allocate_ea_batch: { Args: { _batch_id: string }; Returns: Json }
      allocate_qa_batch: { Args: { _batch_id: string }; Returns: Json }
      approve_batch_deletion: {
        Args: { _decision_reason: string; _request_id: string }
        Returns: number
      }
      ea_set_decision: {
        Args: {
          _comment?: string
          _escalated_comment?: string
          _escalated_date?: string
          _exception_hold_comment?: string
          _final_decision?: string
          _followup_1?: string
          _followup_2?: string
          _followup_3?: string
          _line_id: string
          _rejected_reason?: string
          _status: Database["public"]["Enums"]["ea_daily_status"]
        }
        Returns: undefined
      }
      get_team_lead_for: { Args: { _auditor: string }; Returns: string }
      get_tl_benchmarks: {
        Args: never
        Returns: {
          auditor_id: string
          default_count: number
          email: string
          full_name: string
          kind: Database["public"]["Enums"]["benchmark_kind"]
          present_today: boolean
          today_count: number
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_my_reporting_auditor: { Args: { _auditor: string }; Returns: boolean }
      publish_issues_to_aa: { Args: { _line_ids: string[] }; Returns: Json }
      publish_issues_to_aa_by_approved_by: {
        Args: { _line_ids: string[] }
        Returns: Json
      }
      publish_issues_to_aa_user: {
        Args: { _aa_user_id: string; _line_ids: string[] }
        Returns: Json
      }
      reassign_auditor:
        | { Args: { _from: string; _to: string }; Returns: number }
        | {
            Args: { _from: string; _limit?: number; _to: string }
            Returns: number
          }
      reject_batch_deletion: {
        Args: { _decision_reason: string; _request_id: string }
        Returns: undefined
      }
      request_batch_deletion: {
        Args: { _batch_id: string; _reason: string }
        Returns: string
      }
      upsert_benchmark: {
        Args: {
          _auditor: string
          _default: number
          _kind: Database["public"]["Enums"]["benchmark_kind"]
          _today: number
        }
        Returns: undefined
      }
      user_pending_workload: { Args: { _user_id: string }; Returns: Json }
    }
    Enums: {
      aa_status:
        | "allocated"
        | "approved"
        | "rejected"
        | "escalated"
        | "exception"
      app_role: "admin" | "auditor" | "team_lead" | "expense_auditor"
      benchmark_kind: "qa" | "ea"
      delete_request_status: "pending" | "approved" | "rejected"
      ea_daily_status:
        | "allocated"
        | "approved"
        | "rejected"
        | "exception"
        | "escalated"
      line_status: "allocated" | "completed" | "issue" | "duplicate"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      aa_status: [
        "allocated",
        "approved",
        "rejected",
        "escalated",
        "exception",
      ],
      app_role: ["admin", "auditor", "team_lead", "expense_auditor"],
      benchmark_kind: ["qa", "ea"],
      delete_request_status: ["pending", "approved", "rejected"],
      ea_daily_status: [
        "allocated",
        "approved",
        "rejected",
        "exception",
        "escalated",
      ],
      line_status: ["allocated", "completed", "issue", "duplicate"],
    },
  },
} as const
