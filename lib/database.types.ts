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
      _respaldo_demo_20260926: {
        Row: {
          appointment_date: string | null
          id: string | null
          respaldado_en: string | null
          status_original: string | null
        }
        Insert: {
          appointment_date?: string | null
          id?: string | null
          respaldado_en?: string | null
          status_original?: string | null
        }
        Update: {
          appointment_date?: string | null
          id?: string | null
          respaldado_en?: string | null
          status_original?: string | null
        }
        Relationships: []
      }
      ai_conversations: {
        Row: {
          client_email: string | null
          client_id: string | null
          client_name: string | null
          created_at: string | null
          id: string
          last_message_at: string | null
          last_wa_msg_id: string | null
          messages: Json
          phone: string
          tenant_id: string
        }
        Insert: {
          client_email?: string | null
          client_id?: string | null
          client_name?: string | null
          created_at?: string | null
          id?: string
          last_message_at?: string | null
          last_wa_msg_id?: string | null
          messages?: Json
          phone: string
          tenant_id: string
        }
        Update: {
          client_email?: string | null
          client_id?: string | null
          client_name?: string | null
          created_at?: string | null
          id?: string
          last_message_at?: string | null
          last_wa_msg_id?: string | null
          messages?: Json
          phone?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_conversations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_usage: {
        Row: {
          completion_tokens: number
          day: string
          id: string
          messages: number
          prompt_tokens: number
          tenant_id: string
        }
        Insert: {
          completion_tokens?: number
          day?: string
          id?: string
          messages?: number
          prompt_tokens?: number
          tenant_id: string
        }
        Update: {
          completion_tokens?: number
          day?: string
          id?: string
          messages?: number
          prompt_tokens?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment_series: {
        Row: {
          appointment_time: string
          client_id: string
          created_at: string
          created_by: string | null
          every_weeks: number
          id: string
          location_id: string | null
          occurrences: number
          professional_id: string | null
          service_id: string | null
          start_date: string
          tenant_id: string
        }
        Insert: {
          appointment_time: string
          client_id: string
          created_at?: string
          created_by?: string | null
          every_weeks: number
          id?: string
          location_id?: string | null
          occurrences: number
          professional_id?: string | null
          service_id?: string | null
          start_date: string
          tenant_id: string
        }
        Update: {
          appointment_time?: string
          client_id?: string
          created_at?: string
          created_by?: string | null
          every_weeks?: number
          id?: string
          location_id?: string | null
          occurrences?: number
          professional_id?: string | null
          service_id?: string | null
          start_date?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_series_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_series_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_series_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_series_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_series_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment_services: {
        Row: {
          appointment_id: string
          created_at: string
          id: string
          name: string
          price: number
          service_id: string | null
        }
        Insert: {
          appointment_id: string
          created_at?: string
          id?: string
          name: string
          price?: number
          service_id?: string | null
        }
        Update: {
          appointment_id?: string
          created_at?: string
          id?: string
          name?: string
          price?: number
          service_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "appointment_services_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_services_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          appointment_date: string
          appointment_time: string
          client_id: string | null
          created_at: string | null
          deposit_paid: boolean | null
          id: string
          location_id: string | null
          manage_token: string | null
          notes: string | null
          professional_id: string | null
          series_id: string | null
          service_id: string | null
          status: string | null
          stripe_payment_intent_id: string | null
          tenant_id: string | null
        }
        Insert: {
          appointment_date: string
          appointment_time: string
          client_id?: string | null
          created_at?: string | null
          deposit_paid?: boolean | null
          id?: string
          location_id?: string | null
          manage_token?: string | null
          notes?: string | null
          professional_id?: string | null
          series_id?: string | null
          service_id?: string | null
          status?: string | null
          stripe_payment_intent_id?: string | null
          tenant_id?: string | null
        }
        Update: {
          appointment_date?: string
          appointment_time?: string
          client_id?: string | null
          created_at?: string | null
          deposit_paid?: boolean | null
          id?: string
          location_id?: string | null
          manage_token?: string | null
          notes?: string | null
          professional_id?: string | null
          series_id?: string | null
          service_id?: string | null
          status?: string | null
          stripe_payment_intent_id?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "appointments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "appointment_series"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      blocked_slots: {
        Row: {
          blocked_date: string
          created_at: string | null
          end_time: string
          id: string
          professional_id: string | null
          reason: string | null
          start_time: string
          tenant_id: string
        }
        Insert: {
          blocked_date: string
          created_at?: string | null
          end_time: string
          id?: string
          professional_id?: string | null
          reason?: string | null
          start_time: string
          tenant_id: string
        }
        Update: {
          blocked_date?: string
          created_at?: string | null
          end_time?: string
          id?: string
          professional_id?: string | null
          reason?: string | null
          start_time?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "blocked_slots_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blocked_slots_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      branding: {
        Row: {
          background_image_url: string | null
          bg_blur: number | null
          bg_overlay: number | null
          bg_position: string | null
          business_name: string
          created_at: string
          font_family: string | null
          id: string
          logo_object_position: string | null
          logo_size: number | null
          logo_url: string | null
          primary_color: string
          secondary_color: string
          site_theme: string
          tenant_id: string
          updated_at: string
          welcome_message: string
        }
        Insert: {
          background_image_url?: string | null
          bg_blur?: number | null
          bg_overlay?: number | null
          bg_position?: string | null
          business_name?: string
          created_at?: string
          font_family?: string | null
          id?: string
          logo_object_position?: string | null
          logo_size?: number | null
          logo_url?: string | null
          primary_color?: string
          secondary_color?: string
          site_theme?: string
          tenant_id: string
          updated_at?: string
          welcome_message?: string
        }
        Update: {
          background_image_url?: string | null
          bg_blur?: number | null
          bg_overlay?: number | null
          bg_position?: string | null
          business_name?: string
          created_at?: string
          font_family?: string | null
          id?: string
          logo_object_position?: string | null
          logo_size?: number | null
          logo_url?: string | null
          primary_color?: string
          secondary_color?: string
          site_theme?: string
          tenant_id?: string
          updated_at?: string
          welcome_message?: string
        }
        Relationships: [
          {
            foreignKeyName: "branding_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      business_cost_templates: {
        Row: {
          active: boolean
          amount: number
          category: string
          created_at: string | null
          id: string
          name: string
          tenant_id: string
          type: string
        }
        Insert: {
          active?: boolean
          amount?: number
          category?: string
          created_at?: string | null
          id?: string
          name: string
          tenant_id: string
          type?: string
        }
        Update: {
          active?: boolean
          amount?: number
          category?: string
          created_at?: string | null
          id?: string
          name?: string
          tenant_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_cost_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      business_costs: {
        Row: {
          amount: number
          category: string
          created_at: string | null
          id: string
          month: string
          name: string
          note: string | null
          template_id: string | null
          tenant_id: string
          type: string
        }
        Insert: {
          amount?: number
          category?: string
          created_at?: string | null
          id?: string
          month: string
          name: string
          note?: string | null
          template_id?: string | null
          tenant_id: string
          type?: string
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string | null
          id?: string
          month?: string
          name?: string
          note?: string | null
          template_id?: string | null
          tenant_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_costs_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "business_cost_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_costs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_movements: {
        Row: {
          amount: number
          category: string | null
          created_at: string
          description: string
          id: string
          layaway_payment_id: string | null
          payment_method: string | null
          pos_sale_id: string | null
          professional_id: string | null
          session_id: string
          tenant_id: string
          type: string
        }
        Insert: {
          amount: number
          category?: string | null
          created_at?: string
          description: string
          id?: string
          layaway_payment_id?: string | null
          payment_method?: string | null
          pos_sale_id?: string | null
          professional_id?: string | null
          session_id: string
          tenant_id: string
          type: string
        }
        Update: {
          amount?: number
          category?: string | null
          created_at?: string
          description?: string
          id?: string
          layaway_payment_id?: string | null
          payment_method?: string | null
          pos_sale_id?: string | null
          professional_id?: string | null
          session_id?: string
          tenant_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_movements_layaway_payment_id_fkey"
            columns: ["layaway_payment_id"]
            isOneToOne: false
            referencedRelation: "client_layaway_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_pos_sale_id_fkey"
            columns: ["pos_sale_id"]
            isOneToOne: false
            referencedRelation: "pos_sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "cash_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_sessions: {
        Row: {
          closed_at: string | null
          closing_amount: number | null
          closing_note: string | null
          created_at: string
          id: string
          location_id: string | null
          opened_at: string
          opening_amount: number
          opening_note: string | null
          tenant_id: string
        }
        Insert: {
          closed_at?: string | null
          closing_amount?: number | null
          closing_note?: string | null
          created_at?: string
          id?: string
          location_id?: string | null
          opened_at?: string
          opening_amount?: number
          opening_note?: string | null
          tenant_id: string
        }
        Update: {
          closed_at?: string | null
          closing_amount?: number | null
          closing_note?: string | null
          created_at?: string
          id?: string
          location_id?: string | null
          opened_at?: string
          opening_amount?: number
          opening_note?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_sessions_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_sessions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      client_field_values: {
        Row: {
          client_id: string
          created_at: string
          field_id: string
          field_key: string
          id: string
          tenant_id: string
          updated_at: string
          value: string | null
        }
        Insert: {
          client_id: string
          created_at?: string
          field_id: string
          field_key: string
          id?: string
          tenant_id: string
          updated_at?: string
          value?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string
          field_id?: string
          field_key?: string
          id?: string
          tenant_id?: string
          updated_at?: string
          value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_field_values_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_field_values_field_id_fkey"
            columns: ["field_id"]
            isOneToOne: false
            referencedRelation: "custom_fields"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_field_values_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      client_layaway_payments: {
        Row: {
          amount: number
          cash_movement_id: string | null
          created_at: string
          created_by: string | null
          email_sent_at: string | null
          id: string
          layaway_id: string
          note: string | null
          payment_method: string
          tenant_id: string
        }
        Insert: {
          amount: number
          cash_movement_id?: string | null
          created_at?: string
          created_by?: string | null
          email_sent_at?: string | null
          id?: string
          layaway_id: string
          note?: string | null
          payment_method?: string
          tenant_id: string
        }
        Update: {
          amount?: number
          cash_movement_id?: string | null
          created_at?: string
          created_by?: string | null
          email_sent_at?: string | null
          id?: string
          layaway_id?: string
          note?: string | null
          payment_method?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_layaway_payments_cash_movement_id_fkey"
            columns: ["cash_movement_id"]
            isOneToOne: false
            referencedRelation: "cash_movements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_layaway_payments_layaway_id_fkey"
            columns: ["layaway_id"]
            isOneToOne: false
            referencedRelation: "client_layaways"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_layaway_payments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      client_layaways: {
        Row: {
          cancelled_at: string | null
          client_id: string
          created_at: string
          created_by: string | null
          delivered_at: string | null
          due_date: string | null
          id: string
          item_description: string | null
          item_name: string
          last_reminder_at: string | null
          location_id: string | null
          notes: string | null
          paid_amount: number
          product_id: string | null
          status: string
          tenant_id: string
          total_amount: number
          updated_at: string
        }
        Insert: {
          cancelled_at?: string | null
          client_id: string
          created_at?: string
          created_by?: string | null
          delivered_at?: string | null
          due_date?: string | null
          id?: string
          item_description?: string | null
          item_name: string
          last_reminder_at?: string | null
          location_id?: string | null
          notes?: string | null
          paid_amount?: number
          product_id?: string | null
          status?: string
          tenant_id: string
          total_amount: number
          updated_at?: string
        }
        Update: {
          cancelled_at?: string | null
          client_id?: string
          created_at?: string
          created_by?: string | null
          delivered_at?: string | null
          due_date?: string | null
          id?: string
          item_description?: string | null
          item_name?: string
          last_reminder_at?: string | null
          location_id?: string | null
          notes?: string | null
          paid_amount?: number
          product_id?: string | null
          status?: string
          tenant_id?: string
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_layaways_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_layaways_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_layaways_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_layaways_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          address: string | null
          birthday: string | null
          created_at: string | null
          document: string | null
          email: string | null
          id: string
          name: string
          no_shows: number | null
          notes: string | null
          phone: string
          phone_country_code: string
          tenant_id: string | null
        }
        Insert: {
          address?: string | null
          birthday?: string | null
          created_at?: string | null
          document?: string | null
          email?: string | null
          id?: string
          name: string
          no_shows?: number | null
          notes?: string | null
          phone: string
          phone_country_code?: string
          tenant_id?: string | null
        }
        Update: {
          address?: string | null
          birthday?: string | null
          created_at?: string | null
          document?: string | null
          email?: string | null
          id?: string
          name?: string
          no_shows?: number | null
          notes?: string | null
          phone?: string
          phone_country_code?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clients_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      clinical_access_logs: {
        Row: {
          action: string
          created_at: string
          detail: string | null
          id: string
          record_id: string | null
          tenant_id: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          detail?: string | null
          id?: string
          record_id?: string | null
          tenant_id: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          detail?: string | null
          id?: string
          record_id?: string | null
          tenant_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clinical_access_logs_record_id_fkey"
            columns: ["record_id"]
            isOneToOne: false
            referencedRelation: "clinical_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinical_access_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      clinical_attachments: {
        Row: {
          caption: string | null
          created_at: string
          entry_id: string | null
          id: string
          kind: string
          pair_id: string | null
          record_id: string
          storage_path: string
          tenant_id: string
        }
        Insert: {
          caption?: string | null
          created_at?: string
          entry_id?: string | null
          id?: string
          kind?: string
          pair_id?: string | null
          record_id: string
          storage_path: string
          tenant_id: string
        }
        Update: {
          caption?: string | null
          created_at?: string
          entry_id?: string | null
          id?: string
          kind?: string
          pair_id?: string | null
          record_id?: string
          storage_path?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinical_attachments_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "clinical_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinical_attachments_record_id_fkey"
            columns: ["record_id"]
            isOneToOne: false
            referencedRelation: "clinical_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinical_attachments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      clinical_entries: {
        Row: {
          appointment_id: string | null
          assessment: string | null
          created_at: string
          entry_type: string
          id: string
          objective: string | null
          plan: string | null
          professional_id: string | null
          record_id: string
          signed_at: string | null
          signed_by: string | null
          signed_name: string | null
          status: string
          subjective: string | null
          tenant_id: string
          updated_at: string
          vitals: Json | null
        }
        Insert: {
          appointment_id?: string | null
          assessment?: string | null
          created_at?: string
          entry_type?: string
          id?: string
          objective?: string | null
          plan?: string | null
          professional_id?: string | null
          record_id: string
          signed_at?: string | null
          signed_by?: string | null
          signed_name?: string | null
          status?: string
          subjective?: string | null
          tenant_id: string
          updated_at?: string
          vitals?: Json | null
        }
        Update: {
          appointment_id?: string | null
          assessment?: string | null
          created_at?: string
          entry_type?: string
          id?: string
          objective?: string | null
          plan?: string | null
          professional_id?: string | null
          record_id?: string
          signed_at?: string | null
          signed_by?: string | null
          signed_name?: string | null
          status?: string
          subjective?: string | null
          tenant_id?: string
          updated_at?: string
          vitals?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "clinical_entries_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinical_entries_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinical_entries_record_id_fkey"
            columns: ["record_id"]
            isOneToOne: false
            referencedRelation: "clinical_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinical_entries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      clinical_records: {
        Row: {
          address: string | null
          allergies: string | null
          birth_date: string | null
          blood_type: string | null
          city: string | null
          client_id: string
          created_at: string
          document_number: string | null
          document_type: string | null
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          eps: string | null
          extra: Json
          family_history: string | null
          gender: string | null
          habits: string | null
          id: string
          medical_history: string | null
          medications: string | null
          occupation: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          allergies?: string | null
          birth_date?: string | null
          blood_type?: string | null
          city?: string | null
          client_id: string
          created_at?: string
          document_number?: string | null
          document_type?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          eps?: string | null
          extra?: Json
          family_history?: string | null
          gender?: string | null
          habits?: string | null
          id?: string
          medical_history?: string | null
          medications?: string | null
          occupation?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          allergies?: string | null
          birth_date?: string | null
          blood_type?: string | null
          city?: string | null
          client_id?: string
          created_at?: string
          document_number?: string | null
          document_type?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          eps?: string | null
          extra?: Json
          family_history?: string | null
          gender?: string | null
          habits?: string | null
          id?: string
          medical_history?: string | null
          medications?: string | null
          occupation?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinical_records_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinical_records_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      commission_payments: {
        Row: {
          appointments_count: number
          commission_amount: number
          created_at: string
          id: string
          note: string | null
          paid_at: string
          period_end: string
          period_start: string
          product_commission: number | null
          product_sales_total: number | null
          professional_id: string
          revenue_total: number
          service_commission: number | null
          statement_id: string | null
          tenant_id: string
        }
        Insert: {
          appointments_count?: number
          commission_amount?: number
          created_at?: string
          id?: string
          note?: string | null
          paid_at?: string
          period_end: string
          period_start: string
          product_commission?: number | null
          product_sales_total?: number | null
          professional_id: string
          revenue_total?: number
          service_commission?: number | null
          statement_id?: string | null
          tenant_id: string
        }
        Update: {
          appointments_count?: number
          commission_amount?: number
          created_at?: string
          id?: string
          note?: string | null
          paid_at?: string
          period_end?: string
          period_start?: string
          product_commission?: number | null
          product_sales_total?: number | null
          professional_id?: string
          revenue_total?: number
          service_commission?: number | null
          statement_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "commission_payments_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_payments_statement_id_fkey"
            columns: ["statement_id"]
            isOneToOne: false
            referencedRelation: "payroll_statements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_payments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      commission_rules: {
        Row: {
          created_at: string
          id: string
          professional_id: string
          tenant_id: string
          type: string
          updated_at: string
          value: number
        }
        Insert: {
          created_at?: string
          id?: string
          professional_id: string
          tenant_id: string
          type: string
          updated_at?: string
          value?: number
        }
        Update: {
          created_at?: string
          id?: string
          professional_id?: string
          tenant_id?: string
          type?: string
          updated_at?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "commission_rules_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_rules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      commission_service_rules: {
        Row: {
          created_at: string
          id: string
          professional_id: string | null
          service_id: string
          tenant_id: string
          type: string
          updated_at: string
          value: number
        }
        Insert: {
          created_at?: string
          id?: string
          professional_id?: string | null
          service_id: string
          tenant_id: string
          type: string
          updated_at?: string
          value?: number
        }
        Update: {
          created_at?: string
          id?: string
          professional_id?: string | null
          service_id?: string
          tenant_id?: string
          type?: string
          updated_at?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "commission_service_rules_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_service_rules_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_service_rules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      consent_templates: {
        Row: {
          active: boolean
          body: string
          created_at: string
          id: string
          tenant_id: string
          title: string
        }
        Insert: {
          active?: boolean
          body: string
          created_at?: string
          id?: string
          tenant_id: string
          title: string
        }
        Update: {
          active?: boolean
          body?: string
          created_at?: string
          id?: string
          tenant_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "consent_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      consents: {
        Row: {
          body_snapshot: string
          created_at: string
          id: string
          professional_id: string | null
          record_id: string
          signature_data: string
          signed_at: string
          signed_document: string | null
          signed_name: string
          template_id: string | null
          tenant_id: string
          title: string
        }
        Insert: {
          body_snapshot: string
          created_at?: string
          id?: string
          professional_id?: string | null
          record_id: string
          signature_data: string
          signed_at?: string
          signed_document?: string | null
          signed_name: string
          template_id?: string | null
          tenant_id: string
          title: string
        }
        Update: {
          body_snapshot?: string
          created_at?: string
          id?: string
          professional_id?: string | null
          record_id?: string
          signature_data?: string
          signed_at?: string
          signed_document?: string | null
          signed_name?: string
          template_id?: string | null
          tenant_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "consents_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consents_record_id_fkey"
            columns: ["record_id"]
            isOneToOne: false
            referencedRelation: "clinical_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consents_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "consent_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_fields: {
        Row: {
          active: boolean
          applies_to: string
          created_at: string
          field_key: string
          field_type: string
          id: string
          name: string
          options: Json
          position: number
          required: boolean
          service_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          applies_to?: string
          created_at?: string
          field_key: string
          field_type?: string
          id?: string
          name: string
          options?: Json
          position?: number
          required?: boolean
          service_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          applies_to?: string
          created_at?: string
          field_key?: string
          field_type?: string
          id?: string
          name?: string
          options?: Json
          position?: number
          required?: boolean
          service_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "custom_fields_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_fields_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      email_otp_codes: {
        Row: {
          attempts: number
          code: string
          created_at: string | null
          email: string
          expires_at: string
        }
        Insert: {
          attempts?: number
          code: string
          created_at?: string | null
          email: string
          expires_at: string
        }
        Update: {
          attempts?: number
          code?: string
          created_at?: string | null
          email?: string
          expires_at?: string
        }
        Relationships: []
      }
      gift_card_transactions: {
        Row: {
          amount: number
          balance_after: number
          created_at: string
          created_by: string | null
          gift_card_id: string
          id: string
          note: string | null
          pos_sale_id: string | null
          tenant_id: string
          type: string
        }
        Insert: {
          amount: number
          balance_after: number
          created_at?: string
          created_by?: string | null
          gift_card_id: string
          id?: string
          note?: string | null
          pos_sale_id?: string | null
          tenant_id: string
          type: string
        }
        Update: {
          amount?: number
          balance_after?: number
          created_at?: string
          created_by?: string | null
          gift_card_id?: string
          id?: string
          note?: string | null
          pos_sale_id?: string | null
          tenant_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "gift_card_transactions_gift_card_id_fkey"
            columns: ["gift_card_id"]
            isOneToOne: false
            referencedRelation: "gift_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gift_card_transactions_pos_sale_id_fkey"
            columns: ["pos_sale_id"]
            isOneToOne: false
            referencedRelation: "pos_sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gift_card_transactions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      gift_cards: {
        Row: {
          balance: number
          buyer_client_id: string | null
          code: string
          created_at: string
          created_by: string | null
          email_sent_at: string | null
          expires_at: string | null
          id: string
          initial_amount: number
          location_id: string | null
          message: string | null
          notes: string | null
          pos_sale_id: string | null
          recipient_email: string | null
          recipient_name: string | null
          recipient_phone: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          balance: number
          buyer_client_id?: string | null
          code?: string
          created_at?: string
          created_by?: string | null
          email_sent_at?: string | null
          expires_at?: string | null
          id?: string
          initial_amount: number
          location_id?: string | null
          message?: string | null
          notes?: string | null
          pos_sale_id?: string | null
          recipient_email?: string | null
          recipient_name?: string | null
          recipient_phone?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          balance?: number
          buyer_client_id?: string | null
          code?: string
          created_at?: string
          created_by?: string | null
          email_sent_at?: string | null
          expires_at?: string | null
          id?: string
          initial_amount?: number
          location_id?: string | null
          message?: string | null
          notes?: string | null
          pos_sale_id?: string | null
          recipient_email?: string | null
          recipient_name?: string | null
          recipient_phone?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gift_cards_buyer_client_id_fkey"
            columns: ["buyer_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gift_cards_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gift_cards_pos_sale_id_fkey"
            columns: ["pos_sale_id"]
            isOneToOne: false
            referencedRelation: "pos_sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gift_cards_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      google_review_settings: {
        Row: {
          created_at: string
          google_maps_url: string | null
          id: string
          message_template: string | null
          show_on_booking: boolean
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          google_maps_url?: string | null
          id?: string
          message_template?: string | null
          show_on_booking?: boolean
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          google_maps_url?: string | null
          id?: string
          message_template?: string | null
          show_on_booking?: boolean
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "google_review_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      hanna_config: {
        Row: {
          extra_instructions: string | null
          greeting: string | null
          tenant_id: string
          tone: string | null
          updated_at: string
        }
        Insert: {
          extra_instructions?: string | null
          greeting?: string | null
          tenant_id: string
          tone?: string | null
          updated_at?: string
        }
        Update: {
          extra_instructions?: string | null
          greeting?: string | null
          tenant_id?: string
          tone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hanna_config_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      hanna_insights: {
        Row: {
          created_at: string
          digest: Json
          id: string
          tenant_id: string
          week_start: string
        }
        Insert: {
          created_at?: string
          digest: Json
          id?: string
          tenant_id: string
          week_start: string
        }
        Update: {
          created_at?: string
          digest?: Json
          id?: string
          tenant_id?: string
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "hanna_insights_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      integrations: {
        Row: {
          created_at: string
          google_calendar_id: string | null
          id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          google_calendar_id?: string | null
          id?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          google_calendar_id?: string | null
          id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integrations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_movements: {
        Row: {
          created_at: string
          id: string
          location_id: string | null
          notes: string | null
          product_id: string
          quantity: number
          reference: string | null
          tenant_id: string
          type: string
          unit_cost: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          location_id?: string | null
          notes?: string | null
          product_id: string
          quantity: number
          reference?: string | null
          tenant_id: string
          type: string
          unit_cost?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          location_id?: string | null
          notes?: string | null
          product_id?: string
          quantity?: number
          reference?: string | null
          tenant_id?: string
          type?: string
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_movements_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_items: {
        Row: {
          id: string
          invoice_id: string
          is_excluded: number
          name: string
          price: number
          quantity: number
          tax_rate: string
          total: number
        }
        Insert: {
          id?: string
          invoice_id: string
          is_excluded?: number
          name: string
          price: number
          quantity?: number
          tax_rate?: string
          total?: number
        }
        Update: {
          id?: string
          invoice_id?: string
          is_excluded?: number
          name?: string
          price?: number
          quantity?: number
          tax_rate?: string
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_settings: {
        Row: {
          address: string | null
          company_name: string | null
          created_at: string
          dv: string | null
          environment: string
          factus_client_id: string | null
          factus_client_secret: string | null
          factus_password: string | null
          factus_username: string | null
          id: string
          municipality_id: number | null
          nit: string | null
          numbering_range_id: number | null
          phone: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          company_name?: string | null
          created_at?: string
          dv?: string | null
          environment?: string
          factus_client_id?: string | null
          factus_client_secret?: string | null
          factus_password?: string | null
          factus_username?: string | null
          id?: string
          municipality_id?: number | null
          nit?: string | null
          numbering_range_id?: number | null
          phone?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          company_name?: string | null
          created_at?: string
          dv?: string | null
          environment?: string
          factus_client_id?: string | null
          factus_client_secret?: string | null
          factus_password?: string | null
          factus_username?: string | null
          id?: string
          municipality_id?: number | null
          nit?: string | null
          numbering_range_id?: number | null
          phone?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          created_at: string
          credit_note_at: string | null
          credit_note_cufe: string | null
          credit_note_number: string | null
          credit_note_observation: string | null
          credit_note_pdf_url: string | null
          credit_note_reason: string | null
          cufe: string | null
          customer_address: string | null
          customer_email: string | null
          customer_id: string
          customer_id_type: number
          customer_name: string
          customer_phone: string | null
          factus_id: string | null
          factus_response: Json | null
          id: string
          municipality_id: number | null
          notes: string | null
          number: string | null
          payment_method: string
          pdf_url: string | null
          pos_sale_id: string | null
          reference_code: string | null
          status: string
          subtotal: number
          tax_total: number
          tenant_id: string
          total: number
        }
        Insert: {
          created_at?: string
          credit_note_at?: string | null
          credit_note_cufe?: string | null
          credit_note_number?: string | null
          credit_note_observation?: string | null
          credit_note_pdf_url?: string | null
          credit_note_reason?: string | null
          cufe?: string | null
          customer_address?: string | null
          customer_email?: string | null
          customer_id: string
          customer_id_type?: number
          customer_name: string
          customer_phone?: string | null
          factus_id?: string | null
          factus_response?: Json | null
          id?: string
          municipality_id?: number | null
          notes?: string | null
          number?: string | null
          payment_method?: string
          pdf_url?: string | null
          pos_sale_id?: string | null
          reference_code?: string | null
          status?: string
          subtotal?: number
          tax_total?: number
          tenant_id: string
          total?: number
        }
        Update: {
          created_at?: string
          credit_note_at?: string | null
          credit_note_cufe?: string | null
          credit_note_number?: string | null
          credit_note_observation?: string | null
          credit_note_pdf_url?: string | null
          credit_note_reason?: string | null
          cufe?: string | null
          customer_address?: string | null
          customer_email?: string | null
          customer_id?: string
          customer_id_type?: number
          customer_name?: string
          customer_phone?: string | null
          factus_id?: string | null
          factus_response?: Json | null
          id?: string
          municipality_id?: number | null
          notes?: string | null
          number?: string | null
          payment_method?: string
          pdf_url?: string | null
          pos_sale_id?: string | null
          reference_code?: string | null
          status?: string
          subtotal?: number
          tax_total?: number
          tenant_id?: string
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoices_pos_sale_id_fkey"
            columns: ["pos_sale_id"]
            isOneToOne: false
            referencedRelation: "pos_sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_acceptances: {
        Row: {
          accepted_at: string
          document: string
          id: string
          ip_address: string | null
          tenant_id: string
          user_agent: string | null
          user_id: string | null
          version: string
        }
        Insert: {
          accepted_at?: string
          document: string
          id?: string
          ip_address?: string | null
          tenant_id: string
          user_agent?: string | null
          user_id?: string | null
          version: string
        }
        Update: {
          accepted_at?: string
          document?: string
          id?: string
          ip_address?: string | null
          tenant_id?: string
          user_agent?: string | null
          user_id?: string | null
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "legal_acceptances_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      location_admins: {
        Row: {
          accepted_at: string | null
          email: string
          id: string
          invited_at: string | null
          is_active: boolean
          location_id: string
          name: string
          tenant_id: string
          user_id: string | null
        }
        Insert: {
          accepted_at?: string | null
          email: string
          id?: string
          invited_at?: string | null
          is_active?: boolean
          location_id: string
          name?: string
          tenant_id: string
          user_id?: string | null
        }
        Update: {
          accepted_at?: string | null
          email?: string
          id?: string
          invited_at?: string | null
          is_active?: boolean
          location_id?: string
          name?: string
          tenant_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "location_admins_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "location_admins_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      locations: {
        Row: {
          address: string | null
          created_at: string
          id: string
          image_url: string | null
          is_active: boolean
          name: string
          phone: string | null
          tenant_id: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          id?: string
          image_url?: string | null
          is_active?: boolean
          name: string
          phone?: string | null
          tenant_id: string
        }
        Update: {
          address?: string | null
          created_at?: string
          id?: string
          image_url?: string | null
          is_active?: boolean
          name?: string
          phone?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "locations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      loyalty_redemptions: {
        Row: {
          client_id: string
          id: string
          note: string | null
          redeemed_at: string
          reward_id: string
          tenant_id: string
          visits_at_redemption: number
        }
        Insert: {
          client_id: string
          id?: string
          note?: string | null
          redeemed_at?: string
          reward_id: string
          tenant_id: string
          visits_at_redemption: number
        }
        Update: {
          client_id?: string
          id?: string
          note?: string | null
          redeemed_at?: string
          reward_id?: string
          tenant_id?: string
          visits_at_redemption?: number
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_redemptions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_redemptions_reward_id_fkey"
            columns: ["reward_id"]
            isOneToOne: false
            referencedRelation: "loyalty_rewards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_redemptions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      loyalty_rewards: {
        Row: {
          active: boolean
          created_at: string
          id: string
          label: string
          repeats: boolean
          reward_type: string
          reward_value: number | null
          service_id: string | null
          tenant_id: string
          visits_required: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          label: string
          repeats?: boolean
          reward_type: string
          reward_value?: number | null
          service_id?: string | null
          tenant_id: string
          visits_required: number
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          label?: string
          repeats?: boolean
          reward_type?: string
          reward_value?: number | null
          service_id?: string | null
          tenant_id?: string
          visits_required?: number
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_rewards_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_rewards_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      newsletter_subscribers: {
        Row: {
          created_at: string | null
          email: string
          id: string
          source: string
        }
        Insert: {
          created_at?: string | null
          email: string
          id?: string
          source?: string
        }
        Update: {
          created_at?: string | null
          email?: string
          id?: string
          source?: string
        }
        Relationships: []
      }
      odontograms: {
        Row: {
          created_at: string
          created_by: string | null
          data: Json
          id: string
          notes: string | null
          record_id: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          data?: Json
          id?: string
          notes?: string | null
          record_id: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          data?: Json
          id?: string
          notes?: string | null
          record_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "odontograms_record_id_fkey"
            columns: ["record_id"]
            isOneToOne: false
            referencedRelation: "clinical_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "odontograms_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_adjustments: {
        Row: {
          amount: number
          cash_movement_id: string | null
          concept: string | null
          created_at: string
          created_by: string | null
          entry_date: string
          id: string
          kind: string
          pos_sale_item_id: string | null
          professional_id: string
          source: string
          statement_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          cash_movement_id?: string | null
          concept?: string | null
          created_at?: string
          created_by?: string | null
          entry_date: string
          id?: string
          kind: string
          pos_sale_item_id?: string | null
          professional_id: string
          source?: string
          statement_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          cash_movement_id?: string | null
          concept?: string | null
          created_at?: string
          created_by?: string | null
          entry_date?: string
          id?: string
          kind?: string
          pos_sale_item_id?: string | null
          professional_id?: string
          source?: string
          statement_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_adjustments_cash_movement_id_fkey"
            columns: ["cash_movement_id"]
            isOneToOne: true
            referencedRelation: "cash_movements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_adjustments_pos_sale_item_id_fkey"
            columns: ["pos_sale_item_id"]
            isOneToOne: true
            referencedRelation: "pos_sale_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_adjustments_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_adjustments_statement_id_fkey"
            columns: ["statement_id"]
            isOneToOne: false
            referencedRelation: "payroll_statements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_adjustments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_profiles: {
        Row: {
          base_period: string
          base_salary: number
          base_since: string | null
          created_at: string
          id: string
          product_commission_pct: number | null
          professional_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          base_period?: string
          base_salary?: number
          base_since?: string | null
          created_at?: string
          id?: string
          product_commission_pct?: number | null
          professional_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          base_period?: string
          base_salary?: number
          base_since?: string | null
          created_at?: string
          id?: string
          product_commission_pct?: number | null
          professional_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_profiles_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_statements: {
        Row: {
          appointments_count: number
          base_amount: number
          base_days: number
          base_ranges: Json
          bonus_amount: number
          created_at: string
          created_by: string | null
          deduction_amount: number
          detail: Json
          id: string
          note: string | null
          paid_at: string
          period_end: string
          period_start: string
          product_commission: number
          product_sales: number
          professional_id: string
          service_commission: number
          service_sales: number
          tenant_id: string
          tips_amount: number
          total_amount: number
        }
        Insert: {
          appointments_count?: number
          base_amount?: number
          base_days?: number
          base_ranges?: Json
          bonus_amount?: number
          created_at?: string
          created_by?: string | null
          deduction_amount?: number
          detail?: Json
          id: string
          note?: string | null
          paid_at?: string
          period_end: string
          period_start: string
          product_commission?: number
          product_sales?: number
          professional_id: string
          service_commission?: number
          service_sales?: number
          tenant_id: string
          tips_amount?: number
          total_amount?: number
        }
        Update: {
          appointments_count?: number
          base_amount?: number
          base_days?: number
          base_ranges?: Json
          bonus_amount?: number
          created_at?: string
          created_by?: string | null
          deduction_amount?: number
          detail?: Json
          id?: string
          note?: string | null
          paid_at?: string
          period_end?: string
          period_start?: string
          product_commission?: number
          product_sales?: number
          professional_id?: string
          service_commission?: number
          service_sales?: number
          tenant_id?: string
          tips_amount?: number
          total_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "payroll_statements_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_statements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_admins: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      platform_settings: {
        Row: {
          key: string
          updated_at: string | null
          value: string
        }
        Insert: {
          key: string
          updated_at?: string | null
          value: string
        }
        Update: {
          key?: string
          updated_at?: string | null
          value?: string
        }
        Relationships: []
      }
      pos_sale_items: {
        Row: {
          id: string
          item_type: string
          name: string
          price: number
          product_id: string | null
          professional_id: string | null
          quantity: number
          sale_id: string
          service_id: string | null
          unit_price: number | null
        }
        Insert: {
          id?: string
          item_type?: string
          name: string
          price: number
          product_id?: string | null
          professional_id?: string | null
          quantity?: number
          sale_id: string
          service_id?: string | null
          unit_price?: number | null
        }
        Update: {
          id?: string
          item_type?: string
          name?: string
          price?: number
          product_id?: string | null
          professional_id?: string | null
          quantity?: number
          sale_id?: string
          service_id?: string | null
          unit_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "pos_sale_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_sale_items_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "pos_sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_sale_items_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_sales: {
        Row: {
          appointment_id: string | null
          client_id: string | null
          created_at: string
          discount_type: string | null
          discount_value: number
          id: string
          location_id: string | null
          note: string | null
          payment_method: string
          payments: Json | null
          subtotal: number
          tenant_id: string
          total: number
        }
        Insert: {
          appointment_id?: string | null
          client_id?: string | null
          created_at?: string
          discount_type?: string | null
          discount_value?: number
          id?: string
          location_id?: string | null
          note?: string | null
          payment_method?: string
          payments?: Json | null
          subtotal?: number
          tenant_id: string
          total?: number
        }
        Update: {
          appointment_id?: string | null
          client_id?: string | null
          created_at?: string
          discount_type?: string | null
          discount_value?: number
          id?: string
          location_id?: string | null
          note?: string | null
          payment_method?: string
          payments?: Json | null
          subtotal?: number
          tenant_id?: string
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "pos_sales_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_sales_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_sales_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_sales_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      pqrs: {
        Row: {
          created_at: string | null
          description: string
          id: string
          priority: string
          responded_at: string | null
          response: string | null
          status: string
          subject: string
          submitter_email: string | null
          submitter_name: string | null
          submitter_phone: string | null
          target: string
          tenant_id: string | null
          tenant_name: string | null
          type: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description: string
          id?: string
          priority?: string
          responded_at?: string | null
          response?: string | null
          status?: string
          subject: string
          submitter_email?: string | null
          submitter_name?: string | null
          submitter_phone?: string | null
          target?: string
          tenant_id?: string | null
          tenant_name?: string | null
          type?: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string
          id?: string
          priority?: string
          responded_at?: string | null
          response?: string | null
          status?: string
          subject?: string
          submitter_email?: string | null
          submitter_name?: string | null
          submitter_phone?: string | null
          target?: string
          tenant_id?: string | null
          tenant_name?: string | null
          type?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      products: {
        Row: {
          cost_price: number
          created_at: string
          description: string | null
          discount_type: string | null
          discount_value: number
          id: string
          is_active: boolean
          location_id: string | null
          low_stock_alert: number
          name: string
          photo_url: string | null
          sale_price: number
          sku: string | null
          stock_quantity: number
          tags: Json
          tenant_id: string
          updated_at: string
        }
        Insert: {
          cost_price?: number
          created_at?: string
          description?: string | null
          discount_type?: string | null
          discount_value?: number
          id?: string
          is_active?: boolean
          location_id?: string | null
          low_stock_alert?: number
          name: string
          photo_url?: string | null
          sale_price?: number
          sku?: string | null
          stock_quantity?: number
          tags?: Json
          tenant_id: string
          updated_at?: string
        }
        Update: {
          cost_price?: number
          created_at?: string
          description?: string | null
          discount_type?: string | null
          discount_value?: number
          id?: string
          is_active?: boolean
          location_id?: string | null
          low_stock_alert?: number
          name?: string
          photo_url?: string | null
          sale_price?: number
          sku?: string | null
          stock_quantity?: number
          tags?: Json
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      professionals: {
        Row: {
          avatar_url: string | null
          color: string | null
          created_at: string | null
          email: string | null
          id: string
          is_active: boolean | null
          location_id: string | null
          name: string
          permissions: Json | null
          photo_url: string | null
          role: string
          schedule: Json | null
          show_on_booking: boolean
          tenant_id: string | null
          user_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          color?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          is_active?: boolean | null
          location_id?: string | null
          name: string
          permissions?: Json | null
          photo_url?: string | null
          role: string
          schedule?: Json | null
          show_on_booking?: boolean
          tenant_id?: string | null
          user_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          color?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          is_active?: boolean | null
          location_id?: string | null
          name?: string
          permissions?: Json | null
          photo_url?: string | null
          role?: string
          schedule?: Json | null
          show_on_booking?: boolean
          tenant_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "professionals_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "professionals_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      prosthetic_events: {
        Row: {
          appointment_id: string | null
          created_at: string
          id: string
          kind: string
          next_due: string | null
          notes: string | null
          performed_on: string
          professional_id: string | null
          prosthetic_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          appointment_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          next_due?: string | null
          notes?: string | null
          performed_on?: string
          professional_id?: string | null
          prosthetic_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          appointment_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          next_due?: string | null
          notes?: string | null
          performed_on?: string
          professional_id?: string | null
          prosthetic_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prosthetic_events_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prosthetic_events_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prosthetic_events_prosthetic_id_fkey"
            columns: ["prosthetic_id"]
            isOneToOne: false
            referencedRelation: "prosthetics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prosthetic_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      prosthetic_photos: {
        Row: {
          caption: string | null
          created_at: string
          event_id: string | null
          id: string
          kind: string
          prosthetic_id: string
          storage_path: string
          tenant_id: string
        }
        Insert: {
          caption?: string | null
          created_at?: string
          event_id?: string | null
          id?: string
          kind?: string
          prosthetic_id: string
          storage_path: string
          tenant_id: string
        }
        Update: {
          caption?: string | null
          created_at?: string
          event_id?: string | null
          id?: string
          kind?: string
          prosthetic_id?: string
          storage_path?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prosthetic_photos_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "prosthetic_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prosthetic_photos_prosthetic_id_fkey"
            columns: ["prosthetic_id"]
            isOneToOne: false
            referencedRelation: "prosthetics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prosthetic_photos_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      prosthetics: {
        Row: {
          attachment: string | null
          circumference_cm: number | null
          client_id: string
          color: string | null
          created_at: string
          density: string | null
          ear_to_ear_cm: number | null
          front_to_back_cm: number | null
          gray_percent: number | null
          hair_length_cm: number | null
          hair_type: string | null
          id: string
          installed_on: string | null
          model: string | null
          mold_notes: string | null
          next_maintenance: string | null
          notes: string | null
          price: number | null
          reference: string | null
          service_id: string | null
          status: string
          supplier: string | null
          tenant_id: string
          updated_at: string
          warranty_until: string | null
          wave: string | null
        }
        Insert: {
          attachment?: string | null
          circumference_cm?: number | null
          client_id: string
          color?: string | null
          created_at?: string
          density?: string | null
          ear_to_ear_cm?: number | null
          front_to_back_cm?: number | null
          gray_percent?: number | null
          hair_length_cm?: number | null
          hair_type?: string | null
          id?: string
          installed_on?: string | null
          model?: string | null
          mold_notes?: string | null
          next_maintenance?: string | null
          notes?: string | null
          price?: number | null
          reference?: string | null
          service_id?: string | null
          status?: string
          supplier?: string | null
          tenant_id: string
          updated_at?: string
          warranty_until?: string | null
          wave?: string | null
        }
        Update: {
          attachment?: string | null
          circumference_cm?: number | null
          client_id?: string
          color?: string | null
          created_at?: string
          density?: string | null
          ear_to_ear_cm?: number | null
          front_to_back_cm?: number | null
          gray_percent?: number | null
          hair_length_cm?: number | null
          hair_type?: string | null
          id?: string
          installed_on?: string | null
          model?: string | null
          mold_notes?: string | null
          next_maintenance?: string | null
          notes?: string | null
          price?: number | null
          reference?: string | null
          service_id?: string | null
          status?: string
          supplier?: string | null
          tenant_id?: string
          updated_at?: string
          warranty_until?: string | null
          wave?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prosthetics_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prosthetics_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prosthetics_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      reminder_logs: {
        Row: {
          appointment_id: string | null
          channel: string
          client_email: string | null
          client_name: string
          client_phone: string | null
          created_at: string
          id: string
          sent_via: string
          source: string
          tenant_id: string
        }
        Insert: {
          appointment_id?: string | null
          channel?: string
          client_email?: string | null
          client_name: string
          client_phone?: string | null
          created_at?: string
          id?: string
          sent_via?: string
          source?: string
          tenant_id: string
        }
        Update: {
          appointment_id?: string | null
          channel?: string
          client_email?: string | null
          client_name?: string
          client_phone?: string | null
          created_at?: string
          id?: string
          sent_via?: string
          source?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reminder_logs_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminder_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      reminder_settings: {
        Row: {
          created_at: string
          enabled_24h: boolean
          enabled_2h: boolean
          enabled_post: boolean
          hours_before: number
          id: string
          message_template: string
          template_2h: string
          template_post: string
          tenant_id: string
          updated_at: string
          wa_template_name: string | null
        }
        Insert: {
          created_at?: string
          enabled_24h?: boolean
          enabled_2h?: boolean
          enabled_post?: boolean
          hours_before?: number
          id?: string
          message_template?: string
          template_2h?: string
          template_post?: string
          tenant_id: string
          updated_at?: string
          wa_template_name?: string | null
        }
        Update: {
          created_at?: string
          enabled_24h?: boolean
          enabled_2h?: boolean
          enabled_post?: boolean
          hours_before?: number
          id?: string
          message_template?: string
          template_2h?: string
          template_post?: string
          tenant_id?: string
          updated_at?: string
          wa_template_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reminder_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      review_requests: {
        Row: {
          client_id: string | null
          client_name: string
          client_phone: string | null
          created_at: string
          id: string
          reviewed: boolean | null
          sent_via: string
          tenant_id: string
        }
        Insert: {
          client_id?: string | null
          client_name: string
          client_phone?: string | null
          created_at?: string
          id?: string
          reviewed?: boolean | null
          sent_via?: string
          tenant_id: string
        }
        Update: {
          client_id?: string | null
          client_name?: string
          client_phone?: string | null
          created_at?: string
          id?: string
          reviewed?: boolean | null
          sent_via?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_requests_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_requests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      saas_payments: {
        Row: {
          amount: number
          checkout_amount_cents: number | null
          checkout_url: string | null
          created_at: string
          due_date: string | null
          id: string
          kind: string
          method: string | null
          notes: string | null
          overage_amount: number
          paid_at: string | null
          platform_invoice_at: string | null
          platform_invoice_cufe: string | null
          platform_invoice_number: string | null
          platform_invoice_pdf_url: string | null
          reference: string | null
          status: string
          subscription_id: string | null
          tenant_id: string
          wompi_reference: string | null
          wompi_transaction_id: string | null
        }
        Insert: {
          amount: number
          checkout_amount_cents?: number | null
          checkout_url?: string | null
          created_at?: string
          due_date?: string | null
          id?: string
          kind?: string
          method?: string | null
          notes?: string | null
          overage_amount?: number
          paid_at?: string | null
          platform_invoice_at?: string | null
          platform_invoice_cufe?: string | null
          platform_invoice_number?: string | null
          platform_invoice_pdf_url?: string | null
          reference?: string | null
          status?: string
          subscription_id?: string | null
          tenant_id: string
          wompi_reference?: string | null
          wompi_transaction_id?: string | null
        }
        Update: {
          amount?: number
          checkout_amount_cents?: number | null
          checkout_url?: string | null
          created_at?: string
          due_date?: string | null
          id?: string
          kind?: string
          method?: string | null
          notes?: string | null
          overage_amount?: number
          paid_at?: string | null
          platform_invoice_at?: string | null
          platform_invoice_cufe?: string | null
          platform_invoice_number?: string | null
          platform_invoice_pdf_url?: string | null
          reference?: string | null
          status?: string
          subscription_id?: string | null
          tenant_id?: string
          wompi_reference?: string | null
          wompi_transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "saas_payments_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "saas_subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saas_payments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      saas_plans: {
        Row: {
          active: boolean
          billing_cycle: string
          created_at: string
          description: string | null
          features: Json
          id: string
          name: string
          price: number
        }
        Insert: {
          active?: boolean
          billing_cycle?: string
          created_at?: string
          description?: string | null
          features?: Json
          id?: string
          name: string
          price?: number
        }
        Update: {
          active?: boolean
          billing_cycle?: string
          created_at?: string
          description?: string | null
          features?: Json
          id?: string
          name?: string
          price?: number
        }
        Relationships: []
      }
      saas_subscriptions: {
        Row: {
          amount: number
          billing_cycle: string
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          hanna_addon: string
          hanna_addon_price: number
          id: string
          notes: string | null
          period_months: number
          plan_id: string | null
          status: string
          tenant_id: string
          trial_ends_at: string | null
          updated_at: string
          wompi_card_brand: string | null
          wompi_card_last4: string | null
          wompi_card_token: string | null
        }
        Insert: {
          amount?: number
          billing_cycle?: string
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          hanna_addon?: string
          hanna_addon_price?: number
          id?: string
          notes?: string | null
          period_months?: number
          plan_id?: string | null
          status?: string
          tenant_id: string
          trial_ends_at?: string | null
          updated_at?: string
          wompi_card_brand?: string | null
          wompi_card_last4?: string | null
          wompi_card_token?: string | null
        }
        Update: {
          amount?: number
          billing_cycle?: string
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          hanna_addon?: string
          hanna_addon_price?: number
          id?: string
          notes?: string | null
          period_months?: number
          plan_id?: string | null
          status?: string
          tenant_id?: string
          trial_ends_at?: string | null
          updated_at?: string
          wompi_card_brand?: string | null
          wompi_card_last4?: string | null
          wompi_card_token?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "saas_subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "saas_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saas_subscriptions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      service_price_tiers: {
        Row: {
          created_at: string
          id: string
          label: string
          length_category: string
          price: number
          service_id: string
          sort_order: number
          tenant_id: string
          updated_at: string
          volume_category: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          length_category: string
          price: number
          service_id: string
          sort_order?: number
          tenant_id: string
          updated_at?: string
          volume_category?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          length_category?: string
          price?: number
          service_id?: string
          sort_order?: number
          tenant_id?: string
          updated_at?: string
          volume_category?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "service_price_tiers_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_price_tiers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          category: string | null
          code: string | null
          created_at: string | null
          description: string | null
          duration_min: number
          duration_minutes: number
          id: string
          image_url: string | null
          is_active: boolean
          location_id: string | null
          name: string
          position: number
          price: number
          tags: Json
          tenant_id: string | null
        }
        Insert: {
          category?: string | null
          code?: string | null
          created_at?: string | null
          description?: string | null
          duration_min?: number
          duration_minutes: number
          id?: string
          image_url?: string | null
          is_active?: boolean
          location_id?: string | null
          name: string
          position?: number
          price: number
          tags?: Json
          tenant_id?: string | null
        }
        Update: {
          category?: string | null
          code?: string | null
          created_at?: string | null
          description?: string | null
          duration_min?: number
          duration_minutes?: number
          id?: string
          image_url?: string | null
          is_active?: boolean
          location_id?: string | null
          name?: string
          position?: number
          price?: number
          tags?: Json
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "services_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "services_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      site_reviews: {
        Row: {
          client_name: string
          comment: string | null
          created_at: string
          id: string
          rating: number
          responded_at: string | null
          response: string | null
          service: string | null
          status: string
          tenant_id: string
        }
        Insert: {
          client_name: string
          comment?: string | null
          created_at?: string
          id?: string
          rating: number
          responded_at?: string | null
          response?: string | null
          service?: string | null
          status?: string
          tenant_id: string
        }
        Update: {
          client_name?: string
          comment?: string | null
          created_at?: string
          id?: string
          rating?: number
          responded_at?: string | null
          response?: string | null
          service?: string | null
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_reviews_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_alert_logs: {
        Row: {
          alerted_date: string
          created_at: string
          id: string
          product_id: string
          tenant_id: string
        }
        Insert: {
          alerted_date?: string
          created_at?: string
          id?: string
          product_id: string
          tenant_id: string
        }
        Update: {
          alerted_date?: string
          created_at?: string
          id?: string
          product_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_alert_logs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_alert_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_order_items: {
        Row: {
          id: string
          order_id: string
          product_id: string | null
          product_name: string
          product_price: number
          quantity: number
          subtotal: number
        }
        Insert: {
          id?: string
          order_id: string
          product_id?: string | null
          product_name: string
          product_price: number
          quantity: number
          subtotal: number
        }
        Update: {
          id?: string
          order_id?: string
          product_id?: string | null
          product_name?: string
          product_price?: number
          quantity?: number
          subtotal?: number
        }
        Relationships: [
          {
            foreignKeyName: "supplier_order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "supplier_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "supplier_products"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_orders: {
        Row: {
          created_at: string | null
          id: string
          notes: string | null
          order_number: string
          payment_method: string | null
          payment_proof_url: string | null
          payment_status: string
          shipping_address: string | null
          shipping_cost: number
          status: string
          subtotal: number
          supplier_id: string | null
          tenant_id: string | null
          total: number
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          notes?: string | null
          order_number: string
          payment_method?: string | null
          payment_proof_url?: string | null
          payment_status?: string
          shipping_address?: string | null
          shipping_cost?: number
          status?: string
          subtotal?: number
          supplier_id?: string | null
          tenant_id?: string | null
          total?: number
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          notes?: string | null
          order_number?: string
          payment_method?: string | null
          payment_proof_url?: string | null
          payment_status?: string
          shipping_address?: string | null
          shipping_cost?: number
          status?: string
          subtotal?: number
          supplier_id?: string | null
          tenant_id?: string | null
          total?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_products: {
        Row: {
          category: string | null
          created_at: string | null
          description: string | null
          id: string
          images: string[] | null
          is_active: boolean | null
          min_order_qty: number | null
          name: string
          price: number
          stock: number | null
          supplier_id: string
          unit: string | null
          updated_at: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          images?: string[] | null
          is_active?: boolean | null
          min_order_qty?: number | null
          name: string
          price: number
          stock?: number | null
          supplier_id: string
          unit?: string | null
          updated_at?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          images?: string[] | null
          is_active?: boolean | null
          min_order_qty?: number | null
          name?: string
          price?: number
          stock?: number | null
          supplier_id?: string
          unit?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_products_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          address: string | null
          categories: string[] | null
          city: string | null
          company_name: string
          cover_url: string | null
          created_at: string | null
          description: string | null
          email: string
          id: string
          logo_url: string | null
          nit: string | null
          phone: string | null
          rejection_reason: string | null
          status: string
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          address?: string | null
          categories?: string[] | null
          city?: string | null
          company_name: string
          cover_url?: string | null
          created_at?: string | null
          description?: string | null
          email: string
          id?: string
          logo_url?: string | null
          nit?: string | null
          phone?: string | null
          rejection_reason?: string | null
          status?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          address?: string | null
          categories?: string[] | null
          city?: string | null
          company_name?: string
          cover_url?: string | null
          created_at?: string | null
          description?: string | null
          email?: string
          id?: string
          logo_url?: string | null
          nit?: string | null
          phone?: string | null
          rejection_reason?: string | null
          status?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      tenant_settings: {
        Row: {
          auto_confirm: boolean
          deposit_amount: number
          email_notifications: boolean
          id: string
          require_deposit: boolean
          tenant_id: string
          updated_at: string
          whatsapp_reminders: boolean
        }
        Insert: {
          auto_confirm?: boolean
          deposit_amount?: number
          email_notifications?: boolean
          id?: string
          require_deposit?: boolean
          tenant_id: string
          updated_at?: string
          whatsapp_reminders?: boolean
        }
        Update: {
          auto_confirm?: boolean
          deposit_amount?: number
          email_notifications?: boolean
          id?: string
          require_deposit?: boolean
          tenant_id?: string
          updated_at?: string
          whatsapp_reminders?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "tenant_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          address: string | null
          created_at: string | null
          id: string
          name: string
          owner_id: string | null
          phone: string | null
          plan: string
          plan_expires_at: string | null
          push_token: string | null
          settings: Json | null
          slug: string
        }
        Insert: {
          address?: string | null
          created_at?: string | null
          id?: string
          name: string
          owner_id?: string | null
          phone?: string | null
          plan?: string
          plan_expires_at?: string | null
          push_token?: string | null
          settings?: Json | null
          slug: string
        }
        Update: {
          address?: string | null
          created_at?: string | null
          id?: string
          name?: string
          owner_id?: string | null
          phone?: string | null
          plan?: string
          plan_expires_at?: string | null
          push_token?: string | null
          settings?: Json | null
          slug?: string
        }
        Relationships: []
      }
      wa_campaigns: {
        Row: {
          created_at: string
          id: string
          message: string
          name: string
          recipients_count: number
          segment: string
          sent_at: string | null
          status: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          name: string
          recipients_count?: number
          segment?: string
          sent_at?: string | null
          status?: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          name?: string
          recipients_count?: number
          segment?: string
          sent_at?: string | null
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_campaigns_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_chat_messages: {
        Row: {
          body: string
          client_msg_id: string | null
          created_at: string
          direction: string
          error: string | null
          id: string
          phone: string
          sender: string
          sender_name: string | null
          status: string | null
          tenant_id: string
          wa_msg_id: string | null
        }
        Insert: {
          body: string
          client_msg_id?: string | null
          created_at?: string
          direction: string
          error?: string | null
          id?: string
          phone: string
          sender: string
          sender_name?: string | null
          status?: string | null
          tenant_id: string
          wa_msg_id?: string | null
        }
        Update: {
          body?: string
          client_msg_id?: string | null
          created_at?: string
          direction?: string
          error?: string | null
          id?: string
          phone?: string
          sender?: string
          sender_name?: string | null
          status?: string | null
          tenant_id?: string
          wa_msg_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wa_chat_messages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_chats: {
        Row: {
          batch_token: string | null
          bot_paused: boolean
          client_name: string | null
          created_at: string
          last_message_at: string
          last_message_preview: string | null
          locked_until: string | null
          pending_batch: string | null
          phone: string
          tenant_id: string
          unread: number
        }
        Insert: {
          batch_token?: string | null
          bot_paused?: boolean
          client_name?: string | null
          created_at?: string
          last_message_at?: string
          last_message_preview?: string | null
          locked_until?: string | null
          pending_batch?: string | null
          phone: string
          tenant_id: string
          unread?: number
        }
        Update: {
          batch_token?: string | null
          bot_paused?: boolean
          client_name?: string | null
          created_at?: string
          last_message_at?: string
          last_message_preview?: string | null
          locked_until?: string | null
          pending_batch?: string | null
          phone?: string
          tenant_id?: string
          unread?: number
        }
        Relationships: [
          {
            foreignKeyName: "wa_chats_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_message_dedup: {
        Row: {
          created_at: string | null
          wa_msg_id: string
        }
        Insert: {
          created_at?: string | null
          wa_msg_id: string
        }
        Update: {
          created_at?: string | null
          wa_msg_id?: string
        }
        Relationships: []
      }
      wa_message_templates: {
        Row: {
          body_text: string
          category: string
          created_at: string
          id: string
          language: string
          meta_id: string | null
          meta_status: string
          name: string
          rejected_reason: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          body_text: string
          category?: string
          created_at?: string
          id?: string
          language?: string
          meta_id?: string | null
          meta_status?: string
          name: string
          rejected_reason?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          body_text?: string
          category?: string
          created_at?: string
          id?: string
          language?: string
          meta_id?: string | null
          meta_status?: string
          name?: string
          rejected_reason?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_message_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_queue: {
        Row: {
          created_at: string
          error_msg: string | null
          id: string
          phone: string
          phone_number_id: string
          processed_at: string | null
          retry_count: number
          status: string
          tenant_id: string
          text: string
          timings: Json | null
          wa_msg_id: string | null
        }
        Insert: {
          created_at?: string
          error_msg?: string | null
          id?: string
          phone: string
          phone_number_id: string
          processed_at?: string | null
          retry_count?: number
          status?: string
          tenant_id: string
          text: string
          timings?: Json | null
          wa_msg_id?: string | null
        }
        Update: {
          created_at?: string
          error_msg?: string | null
          id?: string
          phone?: string
          phone_number_id?: string
          processed_at?: string | null
          retry_count?: number
          status?: string
          tenant_id?: string
          text?: string
          timings?: Json | null
          wa_msg_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wa_queue_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_signup_log: {
        Row: {
          created_at: string
          detail: Json | null
          id: string
          step: string
          tenant_id: string | null
        }
        Insert: {
          created_at?: string
          detail?: Json | null
          id?: string
          step: string
          tenant_id?: string | null
        }
        Update: {
          created_at?: string
          detail?: Json | null
          id?: string
          step?: string
          tenant_id?: string | null
        }
        Relationships: []
      }
      wa_templates: {
        Row: {
          created_at: string
          id: string
          message: string
          name: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          name: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          name?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      websites: {
        Row: {
          about_image_url: string | null
          about_text: string | null
          about_title: string | null
          created_at: string
          facebook: string | null
          gallery: Json
          hero_headline: string | null
          hero_image_url: string | null
          hero_subtitle: string | null
          id: string
          instagram: string | null
          maps_url: string | null
          meta_description: string | null
          published: boolean
          sections: Json
          show_prices: boolean
          tenant_id: string
          tiktok: string | null
          updated_at: string
          whatsapp: string | null
        }
        Insert: {
          about_image_url?: string | null
          about_text?: string | null
          about_title?: string | null
          created_at?: string
          facebook?: string | null
          gallery?: Json
          hero_headline?: string | null
          hero_image_url?: string | null
          hero_subtitle?: string | null
          id?: string
          instagram?: string | null
          maps_url?: string | null
          meta_description?: string | null
          published?: boolean
          sections?: Json
          show_prices?: boolean
          tenant_id: string
          tiktok?: string | null
          updated_at?: string
          whatsapp?: string | null
        }
        Update: {
          about_image_url?: string | null
          about_text?: string | null
          about_title?: string | null
          created_at?: string
          facebook?: string | null
          gallery?: Json
          hero_headline?: string | null
          hero_image_url?: string | null
          hero_subtitle?: string | null
          id?: string
          instagram?: string | null
          maps_url?: string | null
          meta_description?: string | null
          published?: boolean
          sections?: Json
          show_prices?: boolean
          tenant_id?: string
          tiktok?: string | null
          updated_at?: string
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "websites_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_config: {
        Row: {
          access_token: string
          bot_enabled: boolean
          created_at: string | null
          id: string
          phone_number_id: string
          tenant_id: string
          updated_at: string | null
          verify_token: string | null
          waba_id: string | null
        }
        Insert: {
          access_token: string
          bot_enabled?: boolean
          created_at?: string | null
          id?: string
          phone_number_id: string
          tenant_id: string
          updated_at?: string | null
          verify_token?: string | null
          waba_id?: string | null
        }
        Update: {
          access_token?: string
          bot_enabled?: boolean
          created_at?: string | null
          id?: string
          phone_number_id?: string
          tenant_id?: string
          updated_at?: string | null
          verify_token?: string | null
          waba_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_config_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      zyncra_leads: {
        Row: {
          billing_cycle: string | null
          biz_type: string | null
          business_name: string | null
          checkout_url: string | null
          city: string | null
          collaborators: number | null
          converted_at: string | null
          email: string | null
          first_message_at: string
          handoff_reason: string | null
          hanna_addon: string | null
          human_handoff_at: string | null
          interested_plan: string | null
          last_failure_at: string | null
          last_failure_reason: string | null
          last_human_reply_at: string | null
          last_message_at: string
          last_wa_msg_id: string | null
          locations_count: number | null
          messages: Json
          name: string | null
          nit: string | null
          notes: string | null
          owner_name: string | null
          phone: string
          status: string
          telegram_thread_id: number | null
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          billing_cycle?: string | null
          biz_type?: string | null
          business_name?: string | null
          checkout_url?: string | null
          city?: string | null
          collaborators?: number | null
          converted_at?: string | null
          email?: string | null
          first_message_at?: string
          handoff_reason?: string | null
          hanna_addon?: string | null
          human_handoff_at?: string | null
          interested_plan?: string | null
          last_failure_at?: string | null
          last_failure_reason?: string | null
          last_human_reply_at?: string | null
          last_message_at?: string
          last_wa_msg_id?: string | null
          locations_count?: number | null
          messages?: Json
          name?: string | null
          nit?: string | null
          notes?: string | null
          owner_name?: string | null
          phone: string
          status?: string
          telegram_thread_id?: number | null
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          billing_cycle?: string | null
          biz_type?: string | null
          business_name?: string | null
          checkout_url?: string | null
          city?: string | null
          collaborators?: number | null
          converted_at?: string | null
          email?: string | null
          first_message_at?: string
          handoff_reason?: string | null
          hanna_addon?: string | null
          human_handoff_at?: string | null
          interested_plan?: string | null
          last_failure_at?: string | null
          last_failure_reason?: string | null
          last_human_reply_at?: string | null
          last_message_at?: string
          last_wa_msg_id?: string | null
          locations_count?: number | null
          messages?: Json
          name?: string | null
          nit?: string | null
          notes?: string | null
          owner_name?: string | null
          phone?: string
          status?: string
          telegram_thread_id?: number | null
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "zyncra_leads_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      zyncra_web_chats: {
        Row: {
          biz_type: string | null
          business_name: string | null
          city: string | null
          email: string | null
          first_message_at: string
          last_message_at: string
          lead_phone: string | null
          messages: Json
          name: string | null
          path: string | null
          phone: string | null
          referrer_host: string | null
          session_id: string
          updated_at: string
          utm_source: string | null
        }
        Insert: {
          biz_type?: string | null
          business_name?: string | null
          city?: string | null
          email?: string | null
          first_message_at?: string
          last_message_at?: string
          lead_phone?: string | null
          messages?: Json
          name?: string | null
          path?: string | null
          phone?: string | null
          referrer_host?: string | null
          session_id: string
          updated_at?: string
          utm_source?: string | null
        }
        Update: {
          biz_type?: string | null
          business_name?: string | null
          city?: string | null
          email?: string | null
          first_message_at?: string
          last_message_at?: string
          lead_phone?: string | null
          messages?: Json
          name?: string | null
          path?: string | null
          phone?: string | null
          referrer_host?: string | null
          session_id?: string
          updated_at?: string
          utm_source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "zyncra_web_chats_lead_phone_fkey"
            columns: ["lead_phone"]
            isOneToOne: false
            referencedRelation: "zyncra_leads"
            referencedColumns: ["phone"]
          },
        ]
      }
      zyncra_web_events: {
        Row: {
          country: string | null
          created_at: string
          device: string | null
          event: string
          id: number
          meta: Json
          path: string | null
          referrer: string | null
          referrer_host: string | null
          session_id: string
          utm_campaign: string | null
          utm_medium: string | null
          utm_source: string | null
        }
        Insert: {
          country?: string | null
          created_at?: string
          device?: string | null
          event: string
          id?: number
          meta?: Json
          path?: string | null
          referrer?: string | null
          referrer_host?: string | null
          session_id: string
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
        }
        Update: {
          country?: string | null
          created_at?: string
          device?: string | null
          event?: string
          id?: number
          meta?: Json
          path?: string | null
          referrer?: string | null
          referrer_host?: string | null
          session_id?: string
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      anular_nomina: { Args: { p_id: string; p_tenant: string }; Returns: Json }
      client_visit_count: { Args: { p_client_id: string }; Returns: number }
      generate_gift_card_code: { Args: never; Returns: string }
      generate_order_number: { Args: never; Returns: string }
      get_location_admin_context: { Args: { p_user_id: string }; Returns: Json }
      get_public_locations: { Args: { p_tenant_id: string }; Returns: Json }
      get_public_professionals: {
        Args: { p_tenant_id: string }
        Returns: {
          avatar_url: string
          id: string
          is_active: boolean
          location_id: string
          name: string
          photo_url: string
          role: string
          schedule: Json
          show_on_booking: boolean
          tenant_id: string
        }[]
      }
      get_public_tenant: {
        Args: { p_slug: string }
        Returns: {
          id: string
          name: string
          phone: string
          settings: Json
          slug: string
        }[]
      }
      get_staff_context: { Args: never; Returns: Json }
      increment_ai_usage: {
        Args: { p_completion: number; p_prompt: number; p_tenant_id: string }
        Returns: undefined
      }
      is_platform_admin: { Args: { uid: string }; Returns: boolean }
      liberar_push_token: { Args: { p_token: string }; Returns: number }
      liquidar_nomina: { Args: { p: Json }; Returns: Json }
      mi_negocio: {
        Args: never
        Returns: {
          address: string
          currency: string
          id: string
          locale: string
          name: string
          phone: string
          rol: string
          slug: string
          timezone: string
        }[]
      }
      mis_citas_ids: { Args: never; Returns: string[] }
      mis_profesionales_activos: { Args: never; Returns: string[] }
      mis_profesionales_con_montos: { Args: never; Returns: string[] }
      mis_sedes_admin: {
        Args: never
        Returns: {
          location_id: string
          tenant_id: string
        }[]
      }
      mis_tenants_equipo: { Args: never; Returns: string[] }
      mis_tenants_staff: { Args: never; Returns: string[] }
      my_subscription_state: {
        Args: never
        Returns: {
          current_period_end: string
          is_paid: boolean
          status: string
          trial_ends_at: string
        }[]
      }
      nomina_arreglo: { Args: { x: Json }; Returns: Json }
      nomina_zona: { Args: { p_tenant: string }; Returns: string }
      patch_tenant_settings: {
        Args: { p_patch: Json; p_tenant_id?: string }
        Returns: Json
      }
      redeem_gift_card: {
        Args: {
          p_amount: number
          p_card_id: string
          p_note?: string
          p_sale_id?: string
        }
        Returns: number
      }
      storage_puede_gestionar: {
        Args: { p_bucket: string; p_name: string }
        Returns: boolean
      }
      supplier_id_for_user: { Args: { uid: string }; Returns: string }
      tenant_id_for_user: { Args: { uid: string }; Returns: string }
      user_can_access_clinical_records: {
        Args: { t: string }
        Returns: boolean
      }
      user_can_access_clinical_records_txt: {
        Args: { t: string }
        Returns: boolean
      }
      user_can_access_tenant_clinical: { Args: { t: string }; Returns: boolean }
      user_can_access_tenant_clinical_txt: {
        Args: { t: string }
        Returns: boolean
      }
      user_can_access_tenant_staff: { Args: { t: string }; Returns: boolean }
      user_can_access_tenant_staff_txt: {
        Args: { t: string }
        Returns: boolean
      }
      user_can_manage_layaways: { Args: { t: string }; Returns: boolean }
      user_can_manage_money: { Args: { t: string }; Returns: boolean }
      user_can_manage_tenant: { Args: { t: string }; Returns: boolean }
      user_can_manage_tenant_txt: { Args: { t: string }; Returns: boolean }
      wa_batch_append: {
        Args: { p_phone: string; p_tenant: string; p_text: string }
        Returns: {
          batch: string
          token: string
        }[]
      }
      wa_batch_drain: {
        Args: { p_phone: string; p_tenant: string }
        Returns: string
      }
      wa_chat_touch: {
        Args: {
          p_inc_unread: boolean
          p_name: string
          p_phone: string
          p_preview: string
          p_tenant: string
        }
        Returns: undefined
      }
      wa_lock_acquire: {
        Args: { p_phone: string; p_tenant: string; p_ttl_seconds: number }
        Returns: boolean
      }
      wa_lock_release: {
        Args: { p_phone: string; p_tenant: string }
        Returns: undefined
      }
      wa_lock_renew: {
        Args: { p_phone: string; p_tenant: string; p_ttl_seconds: number }
        Returns: undefined
      }
      zyncra_traffic_summary: { Args: { days?: number }; Returns: Json }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
