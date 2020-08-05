import * as cdk from "@aws-cdk/core";
import * as msk from "@aws-cdk/aws-msk";
import * as logs from "@aws-cdk/aws-logs";
import * as s3 from "@aws-cdk/aws-s3";
import * as ec2 from "@aws-cdk/aws-ec2";
import * as kms from "@aws-cdk/aws-kms";
import * as cr from "@aws-cdk/custom-resources";

/**
 *  Properties for a MSK Cluster
 */
export interface ClusterProps {
  /**
   * Instance properties for Broker nodes
   */
  readonly brokerNodeProps: BrokerNodeProps;
  /**
   * The version of Apache Kafka.
   *
   * @link https://docs.aws.amazon.com/msk/latest/developerguide/supported-kafka-versions.html
   */
  readonly kafkaVersion: string;
  /**
   * The name of the cluster.
   *
   * @default - CloudFormation-generated name
   */
  readonly clusterName?: string;
  /**
   * The number of broker nodes you want in the Amazon MSK cluster.
   * You can submit an update to increase the number of broker nodes in a cluster.
   *
   * @default - 1 per subnet
   */
  readonly numberOfBrokerNodes?: number;
  /**
   * Details for client authentication using TLS.
   */
  readonly tlsAuthenticationConfig?: {
    /**
     * List of ACM Certificate Authorities ARNs
     */
    certificateAuthorityArns: string[];
  };
  /**
   * Monitoring configuration to use for your cluster.
   */
  readonly monitoringConfiguration?: MonitoringConfiguration;
  /**
   * Configure your MSK cluster to send broker logs to different destination types.
   */
  readonly brokerLoggingConfiguration?: BrokerLoggingConfiguration;
  /**
   * Config details for encryption in transit.
   *
   * @default TLS_PLAINTEXT
   */
  readonly encryptionInTransitConfig?: EncryptionInTransiteConfig;
}

/**
 * Instance properties for Broker nodes
 */
export interface BrokerNodeProps {
  /**
   * VPC to run Cluster in.
   *
   * Must be at least 2 subnets in two different AZs.
   */
  readonly vpc: ec2.IVpc;
  /**
   * The type of Amazon EC2 instances to use for brokers.
   *
   * @link https://docs.aws.amazon.com/msk/latest/developerguide/msk-create-cluster.html#broker-instance-types
   * @default t3.small
   */
  readonly instanceType?: ec2.InstanceType;
  /**
   * Where to place the nodes within the VPC. Amazon MSK distributes the broker nodes evenly across the subnets that you specify.
   * You can specify either two or three subnets.
   * The subnets that you specify must be in distinct Availability Zones.
   * Client subnets can't be in Availability Zone us-east-1e.
   *
   * @default - default subnet selection strategy, see the EC2 module for details
   */
  readonly vpcSubnets?: ec2.SubnetSelection;
  /**
   * The AWS security groups to associate with the elastic network interfaces in order to specify who can connect to and communicate with the Amazon MSK cluster.
   *
   * @default - a new security group is created.
   */
  readonly securityGroups?: ec2.ISecurityGroup[];
  /**
   * Information about storage volumes attached to MSK broker nodes.
   */
  readonly storageInfo?: StorageInfo;
  /**
   * 	The distribution of broker nodes across Availability Zones.
   * 	This is an optional parameter. If you don't specify it, Amazon MSK gives it the value DEFAULT. You can also explicitly set this parameter to the value DEFAULT.
   * 	NOTE: No other values are currently allowed.
   *
   * 	@default DEFAULT
   */
  readonly brokerAZDistribution?: string;
  /**
   * The Amazon MSK configuration to use for the cluster.
   */
  readonly configurationInfo?: ClusterConfigurationInfo;
}

/**
 * The Amazon MSK configuration to use for the cluster.
 * Note: There is currently no Cloudformation Resource to create a Configuration
 */
export interface ClusterConfigurationInfo {
  /**
   * The Amazon Resource Name (ARN) of the MSK configuration to use.
   * For example, arn:aws:kafka:us-east-1:123456789012:configuration/example-configuration-name/abcdabcd-1234-abcd-1234-abcd123e8e8e-1.
   */
  readonly arn: string;
  /**
   * The revision of the Amazon MSK configuration to use.
   */
  readonly revision: number;
}

/**
 * Information about storage volumes attached to MSK broker nodes.
 */
export interface StorageInfo {
  ebsStorageInfo?: {
    /**
     * The size in GiB of the EBS volume for the data drive on each broker node.
     *
     * @default 200
     */
    volumeSize?: number;
    /**
     * The AWS KMS key for encrypting data at rest.
     *
     * @default MSK creates one for you and uses it on your behalf.
     */
    encryptionKmsKey?: kms.IKey;
  };
}

/**
 * Config details for encryption in transit.
 */
export enum EncryptionInTransiteConfig {
  /**
   * TLS means that client-broker communication is enabled with TLS only.
   */
  TLS = "TLS",
  /**
   * TLS_PLAINTEXT means that client-broker communication is enabled for both TLS-encrypted, as well as plaintext data.
   */
  TLS_PLAINTEXT = "TLS_PLAINTEXT",
  /**
   * PLAINTEXT means that client-broker communication is enabled in plaintext only.
   */
  PLAINTEXT = "PLAINTEXT",
}

export interface BrokerLoggingConfiguration {
  /**
   * The Kinesis Data Firehose delivery stream that is the destination for broker logs.
   *
   * Note: Currently type string as there is no L2 construct for `CfnDeliveryStream`
   */
  firehoseDeliveryStreamArn?: string;
  /**
   * The CloudWatch Logs group that is the destination for broker logs.
   */
  cloudwatchLogGroup?: logs.ILogGroup;
  /**
   * Details of the Amazon S3 destination for broker logs.
   */
  s3?: {
    /**
     * The S3 bucket that is the destination for broker logs.
     */
    bucket: s3.IBucket;
    /**
     * The S3 prefix that is the destination for broker logs.
     */
    prefix?: string;
  };
}

export interface MonitoringConfiguration {
  /**
   * Specifies the level of monitoring for the MSK cluster.
   *
   * @default DEFAULT
   */
  clusterMonitoringLevel?: ClusterMonitoringLevel;
  /**
   * Indicates whether you want to enable or disable the JMX Exporter.
   *
   * @default false
   */
  enableJmxExporter?: boolean;
  /**
   * Use the Prometheus Node Exporter to get CPU and disk metrics for the broker nodes.
   *
   * @default false
   */
  enablePrometheusNodeExporter?: boolean;
}

/**
 * The level of monitoring for the MSK cluster
 *
 * @link https://docs.aws.amazon.com/msk/latest/developerguide/monitoring.html#metrics-details
 */
export enum ClusterMonitoringLevel {
  DEFAULT = "DEFAULT",
  PER_BROKER = "PER_BROKER",
  PER_TOPIC_PER_BROKER = "PER_TOPIC_PER_BROKER",
}

/**
 * Represents a MSK Cluster
 */
export interface ICluster extends cdk.IResource, ec2.IConnectable {
  /*
   * The MSK Cluster ARN
   */
  readonly clusterArn: string;
}

/**
 * Attributes required to import an existing Cluster into the Stack.
 */
export interface ClusterAttributes {
  /*
   * The MSK Cluster ARN
   */
  readonly clusterArn: string;
}

/**
 * Creates a new MSK Cluster
 */
export class Cluster extends cdk.Resource implements ICluster {
  /* The MSK Cluster ARN */
  public readonly clusterArn: string;
  /* Manage connections for this cluster */
  public readonly connections: ec2.Connections;

  constructor(scope: cdk.Construct, id: string, props: ClusterProps) {
    super(scope, id, {
      physicalName: props.clusterName,
    });

    const subnetSelection = props.brokerNodeProps.vpc.selectSubnets({
      ...props.brokerNodeProps.vpcSubnets,
    });

    this.connections = new ec2.Connections({
      securityGroups: props.brokerNodeProps.securityGroups
        ? props.brokerNodeProps.securityGroups
        : [
            new ec2.SecurityGroup(this, "SecurityGroup", {
              vpc: props.brokerNodeProps.vpc,
            }),
          ],
    });

    const cfnProps: msk.CfnClusterProps = {
      clusterName: this.physicalName,
      numberOfBrokerNodes:
        props.numberOfBrokerNodes || subnetSelection.subnets.length,
      brokerNodeGroupInfo: {
        clientSubnets: subnetSelection.subnetIds,
        instanceType: props.brokerNodeProps.instanceType
          ? `kafka.${props.brokerNodeProps.instanceType.toString()}`
          : "kafka.t3.small",
        brokerAzDistribution:
          props.brokerNodeProps.brokerAZDistribution || "DEFAULT",
        securityGroups: this.connections.securityGroups.map(
          (sg) => sg.securityGroupId
        ),
        storageInfo: {
          ebsStorageInfo: {
            volumeSize:
              props.brokerNodeProps.storageInfo?.ebsStorageInfo?.volumeSize ||
              200,
          },
        },
      },
      kafkaVersion: props.kafkaVersion,
      clientAuthentication: {
        tls: {
          certificateAuthorityArnList:
            props.tlsAuthenticationConfig?.certificateAuthorityArns,
        },
      },
      configurationInfo: props.brokerNodeProps.configurationInfo,
      encryptionInfo: {
        encryptionAtRest: {
          dataVolumeKmsKeyId:
            props.brokerNodeProps.storageInfo.ebsStorageInfo.encryptionKmsKey
              .keyId,
        },
        encryptionInTransit: props.encryptionInTransitConfig
          ? {
              clientBroker: props.encryptionInTransitConfig,
              inCluster:
                props.encryptionInTransitConfig !==
                EncryptionInTransiteConfig.PLAINTEXT,
            }
          : undefined,
      },
      enhancedMonitoring: props.monitoringConfiguration?.clusterMonitoringLevel,
      loggingInfo: {
        brokerLogs: {
          cloudWatchLogs: {
            enabled:
              props.brokerLoggingConfiguration?.cloudwatchLogGroup !==
              undefined,
            logGroup:
              props.brokerLoggingConfiguration?.cloudwatchLogGroup?.logGroupArn,
          },
          firehose: {
            enabled:
              props.brokerLoggingConfiguration?.firehoseDeliveryStreamArn !==
              undefined,
            deliveryStream:
              props.brokerLoggingConfiguration?.firehoseDeliveryStreamArn,
          },
          s3: {
            enabled: props.brokerLoggingConfiguration?.s3?.bucket !== undefined,
            bucket: props.brokerLoggingConfiguration?.s3?.bucket.bucketName,
            prefix: props.brokerLoggingConfiguration?.s3?.prefix,
          },
        },
      },
      openMonitoring:
        props.monitoringConfiguration?.enableJmxExporter ||
        props.monitoringConfiguration?.enablePrometheusNodeExporter
          ? {
              prometheus: {
                jmxExporter: props.monitoringConfiguration?.enableJmxExporter
                  ? { enabledInBroker: true }
                  : undefined,
                nodeExporter: props.monitoringConfiguration
                  ?.enablePrometheusNodeExporter
                  ? { enabledInBroker: true }
                  : undefined,
              },
            }
          : undefined,
    };
    const resource = new msk.CfnCluster(this, "Resource", cfnProps);

    this.clusterArn = resource.ref;
  }

  /**
   * Import an existing Cluster into the Stack
   */
  public static fromAttributes(
    scope: cdk.Construct,
    id: string,
    attrs: ClusterAttributes
  ): ICluster {
    class Import extends cdk.Resource {
      public readonly clusterArn = attrs.clusterArn;
      public readonly connections = new ec2.Connections();
      /**
       * Exports this certificate from the stack.
       */
      public export() {
        return attrs;
      }
    }

    return new Import(scope, id);
  }

  /**
   * Get the ZooKeeper Connection string
   *
   * Uses a Custom Resource to make an API call to `describeCluster` using the Javascript SDK
   */
  public get zookeeperConnectionString(): string {
    const zookeeperConnect = new cr.AwsCustomResource(
      this,
      "ZookeeperConnect",
      {
        onUpdate: {
          service: "Kafka",
          action: "describeCluster",
          parameters: {
            ClusterArn: this.clusterArn,
          },
          physicalResourceId: cr.PhysicalResourceId.of(
            "ZooKeeperConnectionString"
          ),
        },
        policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
          resources: [this.clusterArn],
        }),
      }
    );

    return zookeeperConnect.getResponseField(
      "ClusterInfo.ZookeeperConnectString"
    );
  }

  /**
   * Get the list of brokers that a client application can use to bootstrap
   *
   * Uses a Custom Resource to make an API call to `getBootstrapBrokers` using the Javascript SDK
   */
  public get bootstrapBrokers(): string {
    const bootstrapBrokers = new cr.AwsCustomResource(
      this,
      "BootstrapBrokers",
      {
        onUpdate: {
          service: "Kafka",
          action: "getBootstrapBrokers",
          parameters: {
            ClusterArn: this.clusterArn,
          },
          physicalResourceId: cr.PhysicalResourceId.of("BootstrapBrokers"),
        },
        policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
          resources: [this.clusterArn],
        }),
      }
    );

    return bootstrapBrokers.getResponseField("BootstrapBrokerStringTls");
  }
}
