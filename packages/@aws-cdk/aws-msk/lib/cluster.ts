import * as ec2 from '@aws-cdk/aws-ec2';
import * as iam from '@aws-cdk/aws-iam';
import * as kms from '@aws-cdk/aws-kms';
import * as core from '@aws-cdk/core';
import * as cr from '@aws-cdk/custom-resources';
import * as constructs from 'constructs';
import {
  CfnCluster,
  KafkaVersion,
  ClusterProps,
  ClientBrokerEncryption,
} from './';

/**
 * Represents a MSK Cluster
 */
export interface ICluster extends core.IResource, ec2.IConnectable {
  /**
   * The ARN of cluster.
   *
   * @attribute
   */
  readonly clusterArn: string;

  /**
   * The physical name of the cluster.
   *
   * @attribute
   */
  readonly clusterName: string;
}

/**
 * A new or imported MSK Cluster.
 */
abstract class ClusterBase extends core.Resource implements ICluster {
  public abstract readonly clusterArn: string;
  public abstract readonly clusterName: string;
  /** @internal */
  protected _connections: ec2.Connections | undefined;

  /** Manages connections for the cluster */
  public get connections(): ec2.Connections {
    if (!this._connections) {
      throw new Error('An imported Cluster cannot manage its security groups');
    }
    return this._connections;
  }
}

/**
 * Create a MSK Cluster.
 *
 * @resource AWS::MSK::Cluster
 */
export class Cluster extends ClusterBase {
  /**
   * Reference an existing cluster, defined outside of the CDK code, by name.
   */
  public static fromClusterArn(
    scope: constructs.Construct,
    id: string,
    clusterArn: string,
  ): ICluster {
    class Import extends ClusterBase {
      public readonly clusterArn = clusterArn;
      public readonly clusterName = clusterArn.split('/')[1]; // ['arn:partition:kafka:region:account-id', clusterName, clusterId]
    }

    return new Import(scope, id);
  }

  public readonly clusterArn: string;
  public readonly clusterName: string;

  constructor(scope: constructs.Construct, id: string, props: ClusterProps) {
    super(scope, id, {
      physicalName: props.clusterName,
    });

    const brokerNodeGroupProps = props.brokerNodeGroupProps;

    const subnetSelection = brokerNodeGroupProps.vpc.selectSubnets(brokerNodeGroupProps.vpcSubnets);

    this._connections = new ec2.Connections({
      securityGroups: brokerNodeGroupProps.securityGroups ?? [
        new ec2.SecurityGroup(this, 'SecurityGroup', {
          description: 'MSK security group',
          vpc: brokerNodeGroupProps.vpc,
        }),
      ],
    });

    if (subnetSelection.subnets.length < 2) {
      core.Annotations.of(this).addError(
        `Cluster requires at least 2 subnets, got ${subnetSelection.subnets.length}`,
      );
    }

    if (
      !core.Token.isUnresolved(props.clusterName) &&
      !/^[a-zA-Z0-9]+$/.test(props.clusterName) &&
      props.clusterName.length > 64
    ) {
      core.Annotations.of(this).addError(
        'The cluster name must only contain alphanumeric characters and have a maximum length of 64 characters.' +
          `got: '${props.clusterName}. length: ${props.clusterName.length}'`,
      );
    }

    if (
      props.clientAuthentication?.tls?.certificateAuthorityArns &&
      props.clientAuthentication?.sasl?.scram
    ) {
      core.Annotations.of(this).addError(
        'Only one of SASL/SCRAM or TLS client authentication can be set.',
      );
    }

    if (
      props.encryptionInTransit?.clientBroker ===
        ClientBrokerEncryption.PLAINTEXT &&
      (props.clientAuthentication?.tls?.certificateAuthorityArns ||
        props.clientAuthentication?.sasl?.scram)
    ) {
      core.Annotations.of(this).addError(
        'To enable client authentication, you must enabled TLS-encrypted traffic between clients and brokers.',
      );
    } else if (
      props.encryptionInTransit?.clientBroker ===
        ClientBrokerEncryption.TLS_PLAINTEXT &&
      props.clientAuthentication?.sasl?.scram
    ) {
      core.Annotations.of(this).addError(
        'To enable SASL/SCRAM authentication, you must only allow TLS-encrypted traffic between clients and brokers.',
      );
    }

    const volumeSize =
      brokerNodeGroupProps.storageInfo?.ebsStorageInfo?.volumeSize;
    // Minimum: 1 GiB, maximum: 16384 GiB
    if (volumeSize !== undefined && (volumeSize < 1 || volumeSize > 16384)) {
      core.Annotations.of(this).addError(
        'EBS volume size should be in the range 1-16384',
      );
    }

    const instanceType = brokerNodeGroupProps.instanceType
      ? this.mskInstanceType(brokerNodeGroupProps.instanceType)
      : this.mskInstanceType(
        ec2.InstanceType.of(ec2.InstanceClass.M5, ec2.InstanceSize.LARGE),
      );

    const encryptionAtRest = brokerNodeGroupProps.storageInfo?.ebsStorageInfo
      ?.kmsKey
      ? {
        dataVolumeKmsKeyId:
            brokerNodeGroupProps.storageInfo.ebsStorageInfo.kmsKey.keyId,
      }
      : undefined; // MSK will create the managed key

    const encryptionInTransit = {
      clientBroker:
        props.encryptionInTransit?.clientBroker ??
        ClientBrokerEncryption.TLS,
      inCluster: props.encryptionInTransit?.enableInCluster ?? true,
    };

    const openMonitoring =
      props.monitoring?.enableJmxExporter ||
      props.monitoring?.enablePrometheusNodeExporter
        ? {
          prometheus: {
            jmxExporter: props.monitoring?.enableJmxExporter
              ? { enabledInBroker: true }
              : undefined,
            nodeExporter: props.monitoring
              ?.enablePrometheusNodeExporter
              ? { enabledInBroker: true }
              : undefined,
          },
        }
        : undefined;

    const loggingInfo = {
      brokerLogs: {
        cloudWatchLogs: {
          enabled:
            props.logging?.cloudwatchLogGroup !== undefined,
          logGroup:
            props.logging?.cloudwatchLogGroup?.logGroupName,
        },
        firehose: {
          enabled:
            props.logging?.firehoseDeliveryStreamArn !==
            undefined,
          deliveryStream:
            props.logging?.firehoseDeliveryStreamArn,
        },
        s3: {
          enabled: props.logging?.s3?.bucket !== undefined,
          bucket: props.logging?.s3?.bucket.bucketName,
          prefix: props.logging?.s3?.prefix,
        },
      },
    };

    if (
      props.clientAuthentication?.sasl?.scram &&
      props.clientAuthentication?.sasl?.key === undefined
    ) {
      const key = new kms.Key(this, 'SASLKey', {
        description:
          'Used for encrypting MSK secrets for SASL/SCRAM authentication.',
        alias: 'msk/sasl/scram',
      });

      key.addToResourcePolicy(
        new iam.PolicyStatement({
          sid:
            'Allow access through AWS Secrets Manager for all principals in the account that are authorized to use AWS Secrets Manager',
          principals: [new iam.Anyone()],
          actions: [
            'kms:Encrypt',
            'kms:Decrypt',
            'kms:ReEncrypt*',
            'kms:GenerateDataKey*',
            'kms:CreateGrant',
            'kms:DescribeKey',
          ],
          resources: ['*'],
          conditions: {
            StringEquals: {
              'kms:ViaService': `secretsmanager.${core.Aws.REGION}.amazonaws.com`,
              'kms:CallerAccount': core.Aws.ACCOUNT_ID,
            },
          },
        }),
      );
    }
    const clientAuthentication = props.clientAuthentication
      ? {
        sasl: props.clientAuthentication?.sasl?.scram
          ? {
            scram: {
              enabled: props.clientAuthentication?.sasl.scram,
            },
          }
          : undefined,
        tls: props.clientAuthentication?.tls
          ?.certificateAuthorityArns
          ? {
            certificateAuthorityArnList:
                  props.clientAuthentication?.tls
                    ?.certificateAuthorityArns,
          }
          : undefined,
      }
      : undefined;

    const resource = new CfnCluster(this, 'Resource', {
      clusterName: props.clusterName,
      kafkaVersion:
        props.kafkaVersion?.version ?? KafkaVersion.V2_2_1.version,
      numberOfBrokerNodes:
        props.numberOfBrokerNodes !== undefined ? props.numberOfBrokerNodes : 1,
      brokerNodeGroupInfo: {
        instanceType,
        brokerAzDistribution:
          brokerNodeGroupProps.brokerAzDistribution || 'DEFAULT',
        clientSubnets: subnetSelection.subnetIds,
        securityGroups: this.connections.securityGroups.map(
          (group) => group.securityGroupId,
        ),
        storageInfo: {
          ebsStorageInfo: {
            volumeSize: volumeSize || 1000,
          },
        },
      },
      encryptionInfo: {
        encryptionAtRest,
        encryptionInTransit,
      },
      configurationInfo: props.configurationInfo,
      enhancedMonitoring: props.monitoring?.clusterMonitoringLevel,
      openMonitoring: openMonitoring,
      loggingInfo: loggingInfo,
      clientAuthentication: clientAuthentication,
    });

    this.clusterName = this.getResourceNameAttribute(
      core.Fn.select(1, core.Fn.split('/', resource.ref)),
    );
    this.clusterArn = resource.ref;

    resource.applyRemovalPolicy(props.removalPolicy, {
      default: core.RemovalPolicy.RETAIN,
    });
  }

  private mskInstanceType(instanceType: ec2.InstanceType): string {
    return `kafka.${instanceType.toString()}`;
  }

  /**
   * Get the ZooKeeper Connection string
   *
   * Uses a Custom Resource to make an API call to `describeCluster` using the Javascript SDK
   *
   * @param responseField Field to return from API call. eg. ZookeeperConnectString, ZookeeperConnectStringTls
   * @returns - The connection string to use to connect to the Apache ZooKeeper cluster.
   */
  private _zookeeperConnectionString(responseField: string): string {
    const zookeeperConnect = new cr.AwsCustomResource(
      this,
      'ZookeeperConnect',
      {
        onUpdate: {
          service: 'Kafka',
          action: 'describeCluster',
          parameters: {
            ClusterArn: this.clusterArn,
          },
          physicalResourceId: cr.PhysicalResourceId.of(
            'ZooKeeperConnectionString',
          ),
        },
        policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
          resources: [this.clusterArn],
        }),
      },
    );

    return zookeeperConnect.getResponseField(`ClusterInfo.${responseField}`);
  }

  /**
   * Get the ZooKeeper Connection string
   *
   * Uses a Custom Resource to make an API call to `describeCluster` using the Javascript SDK
   *
   * @returns - The connection string to use to connect to the Apache ZooKeeper cluster.
   */
  public get zookeeperConnectionString(): string {
    return this._zookeeperConnectionString('ZookeeperConnectString');
  }

  /**
   * Get the ZooKeeper Connection string for a TLS enabled cluster
   *
   * Uses a Custom Resource to make an API call to `describeCluster` using the Javascript SDK
   *
   * @returns - The connection string to use to connect to zookeeper cluster on TLS port.
   */
  public get zookeeperConnectionStringTls(): string {
    return this._zookeeperConnectionString('ZookeeperConnectStringTls');
  }

  /**
   * Get the list of brokers that a client application can use to bootstrap
   *
   * Uses a Custom Resource to make an API call to `getBootstrapBrokers` using the Javascript SDK
   *
   * @param responseField Field to return from API call. eg. BootstrapBrokerStringSaslScram, BootstrapBrokerString
   * @returns - A string containing one or more hostname:port pairs.
   */
  private _bootstrapBrokers(responseField: string): string {
    const bootstrapBrokers = new cr.AwsCustomResource(
      this,
      'BootstrapBrokers',
      {
        onUpdate: {
          service: 'Kafka',
          action: 'getBootstrapBrokers',
          parameters: {
            ClusterArn: this.clusterArn,
          },
          physicalResourceId: cr.PhysicalResourceId.of('BootstrapBrokers'),
        },
        policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
          resources: [this.clusterArn],
        }),
      },
    );

    return bootstrapBrokers.getResponseField(responseField);
  }
  /**
   * Get the list of brokers that a client application can use to bootstrap
   *
   * Uses a Custom Resource to make an API call to `getBootstrapBrokers` using the Javascript SDK
   *
   * @returns - A string containing one or more hostname:port pairs.
   */
  public get bootstrapBrokers(): string {
    return this._bootstrapBrokers('BootstrapBrokerString');
  }

  /**
   * Get the list of brokers that a TLS authenticated client application can use to bootstrap
   *
   * Uses a Custom Resource to make an API call to `getBootstrapBrokers` using the Javascript SDK
   *
   * @returns - A string containing one or more DNS names (or IP) and TLS port pairs.
   */
  public get bootstrapBrokersTls(): string {
    return this._bootstrapBrokers('BootstrapBrokerStringTls');
  }

  /**
   * Get the list of brokers that a SASL/SCRAM authenticated client application can use to bootstrap
   *
   * Uses a Custom Resource to make an API call to `getBootstrapBrokers` using the Javascript SDK
   *
   * @returns - A string containing one or more dns name (or IP) and SASL SCRAM port pairs.
   */
  public get bootstrapBrokersSaslScram(): string {
    return this._bootstrapBrokers('BootstrapBrokerStringSaslScram');
  }
}
